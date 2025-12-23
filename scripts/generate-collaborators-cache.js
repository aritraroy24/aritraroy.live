// Node.js script to pre-generate collaborator data with geocoding
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const USER_ORCID = '0000-0003-0243-9124';
const WORKS_API_URL = `https://api.openalex.org/works?filter=authorships.author.orcid:${USER_ORCID}&per_page=200`;
const ORCID_WORKS_API = `https://pub.orcid.org/v3.0/${USER_ORCID}/works`;
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';
const PHOTON_API = 'https://photon.komoot.io/api/';
const DATA_DIR = path.join(__dirname, '../src/assets/js/data');
const OUTPUT_FILE = path.join(DATA_DIR, 'collaborations-cache.js');

let lastGeocodingRequest = 0;
async function rateLimitedDelay() {
    const now = Date.now();
    const elapsed = now - lastGeocodingRequest;
    if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
    lastGeocodingRequest = Date.now();
}

async function geocodeWithPhoton(name, country) {
    try {
        await rateLimitedDelay();
        const q = country ? `${name}, ${country}` : name;
        const url = `${PHOTON_API}?q=${encodeURIComponent(q)}&limit=1&lang=en`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const d = await res.json();
        if (d?.features?.length > 0) {
            const f = d.features[0];
            return {
                latitude: parseFloat(f.geometry.coordinates[1]),
                longitude: parseFloat(f.geometry.coordinates[0]),
                city: f.properties.city || f.properties.town || f.properties.name || null,
                country: f.properties.country || null
            };
        }
    } catch (e) { }
    return null;
}

async function geocodeInstitution(name, country) {
    if (!name || name === 'Unknown') return null;
    try {
        await rateLimitedDelay();
        const q = country ? `${name}, ${country}` : name;
        const url = `${NOMINATIM_API}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1&accept-language=en`;
        const res = await fetch(url, { headers: { 'User-Agent': 'BuildScript' } });
        if (res.ok) {
            const d = await res.json();
            if (d?.length > 0) {
                const r = {
                    latitude: parseFloat(d[0].lat),
                    longitude: parseFloat(d[0].lon),
                    city: d[0].address?.city || d[0].address?.town || null,
                    country: d[0].address?.country || null
                };
                if (!isNaN(r.latitude)) return r;
            }
        }
    } catch (e) { }
    return await geocodeWithPhoton(name, country);
}

function formatNameOrder(name) {
    if (!name || typeof name !== 'string') return name;

    // Check if name is in "Last, First Middle" format (contains comma)
    if (name.includes(',')) {
        const parts = name.split(',').map(p => p.trim());
        if (parts.length === 2) {
            // Reverse: "Last, First Middle" -> "First Middle Last"
            return `${parts[1]} ${parts[0]}`;
        }
    }

    // Already in correct format or no comma found
    return name;
}

function selectBestName(names) {
    if (!names || names.length === 0) return null;
    const cleanNames = [...new Set(names.filter(n => n && typeof n === 'string' && !n.startsWith('None ')))]
        .map(n => formatNameOrder(n.trim()));
    if (cleanNames.length === 0) return null;
    if (cleanNames.length === 1) return cleanNames[0];

    const hasInitials = (name) => {
        // Check if name has single letter words followed by optional period (initials)
        return /\b\w\b\.?/.test(name);
    };

    const expandInitials = (nameWithInitials, candidateNames) => {
        // Try to find a full form for a name with initials
        const parts = nameWithInitials.split(/\s+/);

        for (const candidate of candidateNames) {
            if (candidate === nameWithInitials) continue;
            if (hasInitials(candidate)) continue; // Skip if candidate also has initials

            const candidateParts = candidate.split(/\s+/);
            if (candidateParts.length !== parts.length) continue;

            // Check if all parts match (either full word or initial)
            let matches = true;
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i].replace('.', '');
                const candidatePart = candidateParts[i];

                // If it's a single letter (initial), check if it matches first letter of candidate
                if (part.length === 1) {
                    if (part.toUpperCase() !== candidatePart.charAt(0).toUpperCase()) {
                        matches = false;
                        break;
                    }
                } else {
                    // If it's not an initial, must match exactly
                    if (part.toLowerCase() !== candidatePart.toLowerCase()) {
                        matches = false;
                        break;
                    }
                }
            }

            if (matches) return candidate;
        }

        return null;
    };

    // First pass: try to expand names with initials
    for (const name of cleanNames) {
        if (hasInitials(name)) {
            const expanded = expandInitials(name, cleanNames);
            if (expanded) return expanded;
        }
    }

    // If no expansion found, prefer names without initials
    const namesWithoutInitials = cleanNames.filter(n => !hasInitials(n));
    if (namesWithoutInitials.length > 0) {
        // Return the longest name without initials
        return namesWithoutInitials.reduce((longest, current) =>
            current.length > longest.length ? current : longest
        );
    }

    // If all names have initials, just return the first one
    return cleanNames[0];
}

async function determineLatestAffiliations(orcidUrl, oaAff, oaYear, openAlexAuthorId) {
    let candidates = [];
    let bestNameFromOA = null;
    if (oaAff && oaAff !== 'Unknown') candidates.push({ name: oaAff, year: oaYear, isCurrent: false, priority: 1, countryCode: null });

    // Fetch from OpenAlex author profile for affiliations
    if (openAlexAuthorId) {
        try {
            // Convert OpenAlex ID to API URL
            const authorApiUrl = openAlexAuthorId.replace('https://openalex.org/', 'https://api.openalex.org/authors/');
            const authorRes = await fetch(authorApiUrl);
            if (authorRes.ok) {
                const authorData = await authorRes.json();

                // Get best name from OA alternatives
                const allNames = [authorData.display_name, ...(authorData.display_name_alternatives || [])];
                bestNameFromOA = selectBestName(allNames);

                const affiliations = authorData.affiliations || [];
                affiliations.forEach(aff => {
                    if (aff.institution?.display_name && aff.years?.length > 0) {
                        const latestYear = Math.max(...aff.years);
                        const currentYear = new Date().getFullYear();
                        const isCurrent = aff.years.includes(currentYear) || aff.years.includes(currentYear - 1);
                        candidates.push({
                            name: aff.institution.display_name,
                            year: latestYear,
                            isCurrent: isCurrent,
                            priority: 4,
                            countryCode: aff.institution.country_code || null
                        });
                    }
                });
            } else {
                console.log(`  ⚠️  Failed to fetch OpenAlex author profile: ${openAlexAuthorId}`);
            }
        } catch (e) {
            console.log(`  ⚠️  Error fetching OpenAlex author profile: ${e.message}`);
        }
    }

    if (orcidUrl) {
        try {
            const id = orcidUrl.split('/').pop();
            const h = { 'Accept': 'application/json' };
            const [emp, edu] = await Promise.all([
                fetch(`https://pub.orcid.org/v3.0/${id}/employments`, { headers: h }),
                fetch(`https://pub.orcid.org/v3.0/${id}/educations`, { headers: h })
            ]);
            if (emp.ok) {
                const data = await emp.json();
                (data['affiliation-group'] || []).forEach(g => {
                    const s = g['summaries']?.[0]?.['employment-summary'];
                    if (s) candidates.push({ name: s.organization?.name, year: s['start-date'] ? parseInt(s['start-date'].year.value) : 0, isCurrent: !s['end-date'], priority: 3 });
                });
            }
            if (edu.ok) {
                const data = await edu.json();
                (data['affiliation-group'] || []).forEach(g => {
                    const s = g['summaries']?.[0]?.['education-summary'];
                    if (s) candidates.push({ name: s.organization?.name, year: s['start-date'] ? parseInt(s['start-date'].year.value) : 0, isCurrent: !s['end-date'], priority: 2 });
                });
            }
        } catch (e) { }
    }

    let uniqueAffiliations = [];
    if (candidates.length === 0) {
        uniqueAffiliations = [{ name: oaAff, countryCode: null }];
    } else {
        candidates.sort((a, b) => {
            if (a.isCurrent && !b.isCurrent) return -1;
            if (!a.isCurrent && b.isCurrent) return 1;
            if (b.year !== a.year) return b.year - a.year;
            return b.priority - a.priority;
        });

        // Return all candidates that match the top candidate's criteria
        const top = candidates[0];
        const topTied = candidates.filter(c =>
            c.isCurrent === top.isCurrent &&
            c.year === top.year
        );

        // Remove duplicates by institution name, keep first occurrence with country code
        const seen = new Set();
        for (const c of topTied) {
            if (!seen.has(c.name)) {
                seen.add(c.name);
                uniqueAffiliations.push({ name: c.name, countryCode: c.countryCode });
            }
        }
    }

    return {
        bestName: bestNameFromOA,
        affiliations: uniqueAffiliations
    };
}

async function fetchOrcidWorksDetailed() {
    try {
        const res = await fetch(ORCID_WORKS_API, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return new Map();
        const d = await res.json();
        const worksMap = new Map();

        const groups = d.group || [];
        for (const g of groups) {
            const summary = g['work-summary']?.[0];
            if (!summary) continue;

            const putCode = summary['put-code'];
            const extIds = summary['external-ids']?.['external-id'] || [];
            const doiObj = extIds.find(id => id['external-id-type'] === 'doi');
            if (!doiObj) continue;

            const doi = doiObj['external-id-value'].toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
            worksMap.set(doi, { putCode, title: summary.title?.title?.value });
        }
        return worksMap;
    } catch (e) { return new Map(); }
}

async function fetchContributorsFromOrcid(putCode) {
    try {
        const res = await fetch(`https://pub.orcid.org/v3.0/${USER_ORCID}/work/${putCode}`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.contributors?.contributor || []).map(c => ({
            display_name: formatNameOrder(c['credit-name']?.value),
            orcid: c['contributor-orcid'] ? `https://orcid.org/${c['contributor-orcid'].path}` : null
        })).filter(c => c.display_name);
    } catch (e) { return []; }
}

async function loadExisting() {
    if (!fs.existsSync(OUTPUT_FILE)) return { map: new Map(), generationDate: null };
    try {
        const c = fs.readFileSync(OUTPUT_FILE, 'utf8');

        // Extract generation date
        const dateMatch = c.match(/const generationDate = ['"]([^'"]+)['"]/);
        const generationDate = dateMatch ? dateMatch[1] : null;

        // Extract collaborators array
        const m = c.match(/const collaborators = ([\s\S]*?);/);
        if (m) {
            const items = JSON.parse(m[1]);
            return {
                map: new Map(items.map(x => [x.id || x.name, x])),
                generationDate
            };
        }
    } catch (e) {
        console.log(`⚠️  Error loading existing cache: ${e.message}`);
    }
    return { map: new Map(), generationDate: null };
}

async function generate(forceMode = false) {
    console.log('🚀 Generating Cache...');
    try {
        const existingData = await loadExisting();
        const existingMap = existingData.map;
        const lastGeneration = existingData.generationDate;

        // Check if we should do a full update
        const now = new Date();
        const daysSinceLastGen = lastGeneration
            ? (now - new Date(lastGeneration)) / (24 * 60 * 60 * 1000)
            : Infinity;

        // Determine update mode
        let shouldFullUpdate = false;
        let shouldSkipUpdate = false;

        if (forceMode) {
            // Manual run - always do full update
            console.log('🔧 Manual mode: Forcing full regeneration');
            shouldFullUpdate = true;
        } else {
            // Auto mode (prebuild)
            if (!lastGeneration) {
                console.log('📅 No previous generation found - performing full update');
                shouldFullUpdate = true;
            } else if (daysSinceLastGen > 30) {
                console.log(`📅 Last generation was ${Math.round(daysSinceLastGen)} days ago - performing full update for non-manual entries`);
                shouldFullUpdate = true;
            } else {
                console.log(`📅 Last generation was ${Math.round(daysSinceLastGen)} days ago - updating publication counts only`);
                shouldFullUpdate = false;
            }
        }

        const [oaRes, orcidWorksDetailed] = await Promise.all([
            fetch(WORKS_API_URL),
            fetchOrcidWorksDetailed()
        ]);
        if (!oaRes.ok) throw new Error('OpenAlex Response not OK');

        const orcidDois = new Set(orcidWorksDetailed.keys());
        const works = (await oaRes.json()).results || [];
        const colsMap = new Map();

        for (const w of works) {
            const yr = w.publication_year || 0;
            const doi = w.doi?.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
            if (orcidDois.size > 0 && (!doi || !orcidDois.has(doi))) continue;

            // Get authors from OpenAlex
            let authors = (w.authorships || []).map(auth => ({
                id: auth.author.id,
                display_name: formatNameOrder(auth.author.display_name),
                orcid: auth.author.orcid,
                institution: auth.institutions?.[0]?.display_name || 'Unknown'
            }));

            // Check if we should supplement from ORCID (if OpenAlex has very few authors or we suspect missing ones)
            // Or just always merge to be safe
            if (doi && orcidWorksDetailed.has(doi)) {
                const detailed = orcidWorksDetailed.get(doi);
                const orcidAuthors = await fetchContributorsFromOrcid(detailed.putCode);

                for (const oa of orcidAuthors) {
                    const exists = authors.some(a =>
                        (a.orcid && oa.orcid && a.orcid.includes(oa.orcid.split('/').pop())) ||
                        a.display_name.toLowerCase() === oa.display_name.toLowerCase()
                    );
                    if (!exists) {
                        authors.push({
                            id: null, // We don't have OA ID for these
                            display_name: oa.display_name,
                            orcid: oa.orcid,
                            institution: 'Unknown' // ORCID doesn't easily give institution in work contributors
                        });
                    }
                }
            }

            for (const a of authors) {
                if (a.orcid && a.orcid.includes(USER_ORCID)) continue;
                if (a.display_name.toLowerCase().includes('aritra roy')) continue; // Self filter

                const authorId = a.id || a.orcid || a.display_name;
                const inst = a.institution;

                if (colsMap.has(authorId)) {
                    const e = colsMap.get(authorId);
                    if (!e.dois.some(d => d.title === w.title)) {
                        e.collaborations++;
                        e.dois.push({ doi: w.doi || doi, title: w.title });
                    }
                    if (yr > e.latestPaperYear) {
                        e.latestPaperYear = yr;
                        if (inst !== 'Unknown') e.openAlexAffiliation = inst;
                    }
                } else {
                    colsMap.set(authorId, {
                        id: a.id, name: a.display_name, orcid: a.orcid,
                        openAlexAffiliation: inst, latestPaperYear: yr,
                        collaborations: 1, dois: [{ doi: w.doi || doi, title: w.title }]
                    });
                }
            }
        }

        console.log(`👥 Found ${colsMap.size} unique collaborators`);

        const results = [];
        for (const [id, c] of colsMap) {
            // Check cache first to avoid expensive API calls
            const cached = existingMap.get(id) || existingMap.get(c.name);

            if (cached && cached.affiliation && cached.affiliation !== 'Unknown') {
                // Determine if we should do a full update for this entry
                const isManuallyUpdated = cached.updatedManually === true;
                const needsFullUpdate = shouldFullUpdate && !isManuallyUpdated;

                if (needsFullUpdate) {
                    console.log(`🔄 Full Update for: ${cached.name} (auto-managed)`);
                    // Will fetch fresh data below
                } else {
                    console.log(`📋 Using Cached Metadata: ${cached.name}${isManuallyUpdated ? ' (manually maintained)' : ''}`);
                    // Reuse cached metadata but keep fresh stats from colsMap
                    c.name = cached.name;
                    c.affiliation = cached.affiliation;
                    c.latitude = cached.latitude;
                    c.longitude = cached.longitude;
                    c.city = cached.city;
                    c.country = cached.country;
                    c.updatedManually = isManuallyUpdated; // Preserve the flag
                    results.push(c);
                    continue;
                }
            }

            const { bestName, affiliations: affiliationOptions } = await determineLatestAffiliations(c.orcid, c.openAlexAffiliation, c.latestPaperYear, c.id);

            if (bestName) {
                c.name = bestName;
            }

            if (!affiliationOptions || affiliationOptions.length === 0 || (affiliationOptions[0]?.name === 'Unknown' || affiliationOptions[0] === 'Unknown')) continue;

            let foundGeo = false;

            // Try geocoding all options
            console.log(`👤 Processing New Collaborator: ${c.name}`);
            for (const affOpt of affiliationOptions) {
                const affName = typeof affOpt === 'string' ? affOpt : affOpt.name;
                const countryCode = typeof affOpt === 'object' ? affOpt.countryCode : null;
                const geo = await geocodeInstitution(affName, countryCode);
                if (geo && geo.latitude && geo.longitude) {
                    c.affiliation = affName;
                    Object.assign(c, geo);
                    console.log(`  📍 Institution: ${affName} [${geo.latitude}, ${geo.longitude}]`);
                    foundGeo = true;
                    break;
                }
            }

            // If no geocoding succeeded but we have affiliations, use the first one
            if (!foundGeo && affiliationOptions.length > 0) {
                const affName = typeof affiliationOptions[0] === 'string' ? affiliationOptions[0] : affiliationOptions[0].name;
                c.affiliation = affName;
                console.log(`  ⚠️  Using without coordinates: ${c.affiliation}`);
            }

            if (c.affiliation) {
                // Add updatedManually flag for new/updated entries (default: false)
                c.updatedManually = false;
                results.push(c);
            }
        }

        const sorted = results.sort((a, b) => b.collaborations - a.collaborations);
        const currentDate = new Date().toISOString();
        const fileContent = `// Auto-generated collaborator data
// Last updated: ${currentDate}
const generationDate = '${currentDate}';

const collaborators = ${JSON.stringify(sorted, null, 2)};

export { generationDate };
export default collaborators;
`;
        fs.writeFileSync(OUTPUT_FILE, fileContent);
        console.log(`✅ Done! Saved ${sorted.length} collaborators to ${OUTPUT_FILE}`);
        console.log(`📅 Generation date: ${currentDate}`);
    } catch (e) { console.error('❌ Error:', e); }
}

// Check command line arguments
const args = process.argv.slice(2);
const forceMode = args.includes('--force') || args.includes('-f');

generate(forceMode);