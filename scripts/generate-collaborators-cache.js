// Node.js script to pre-generate collaborator data with geocoding
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import manualInstitutes from '../src/assets/js/data/collected/collected-institutional-data.js';
import manualCollaborators from '../src/assets/js/data/collected/collected-collaborator-data.js';

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

async function getInstitutionalDetails(name, countryCode = null) {
    if (!name || name === 'Unknown') {
        return { name: 'Unknown', city: null, country: null, latitude: null, longitude: null, manual: false };
    }

    // Check manual data first - this is the PRIMARY source
    const manualData = manualInstitutes.find(i =>
        i.name.toLowerCase() === name.toLowerCase()
    );

    if (manualData) {
        console.log(`  📝 Using manual data for: ${name}`);
        return {
            name: manualData.name,
            city: manualData.city,
            country: manualData.country,
            latitude: manualData.latitude,
            longitude: manualData.longitude,
            manual: true
        };
    }

    // Fallback to geocoding APIs
    const geo = await geocodeInstitution(name, countryCode);
    if (geo && !isNaN(geo.latitude)) {
        return {
            name: name,
            city: geo.city,
            country: geo.country,
            latitude: geo.latitude,
            longitude: geo.longitude,
            manual: false
        };
    }

    // Return with name but no coordinates
    return { name: name, city: null, country: null, latitude: null, longitude: null, manual: false };
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
        return (data.contributors?.contributor || []).map(c => {
            const orcidPath = c['contributor-orcid']?.path;
            // Only create ORCID URL if path is valid and not "null"
            const orcid = (orcidPath && orcidPath !== 'null' && orcidPath !== 'undefined')
                ? `https://orcid.org/${orcidPath}`
                : null;
            return {
                display_name: formatNameOrder(c['credit-name']?.value),
                orcid: orcid
            };
        }).filter(c => c.display_name);
    } catch (e) { return []; }
}

async function fetchOpenAlexAuthorByOrcid(orcid) {
    if (!orcid) return null;
    try {
        const orcidId = orcid.split('/').pop();
        const url = `https://api.openalex.org/authors?filter=orcid:${orcidId}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const author = data.results[0];
            // Get the most recent affiliation with institution data
            let institution = 'Unknown';
            if (author.affiliations && author.affiliations.length > 0) {
                for (const aff of author.affiliations) {
                    if (aff.institution?.display_name) {
                        institution = aff.institution.display_name;
                        break;
                    }
                }
            }
            return {
                id: author.id,
                display_name: formatNameOrder(author.display_name),
                institution: institution
            };
        }
    } catch (e) {
        console.log(`  ⚠️  Error fetching OpenAlex author by ORCID ${orcid}: ${e.message}`);
    }
    return null;
}

async function fetchOpenAlexAuthorByName(name) {
    if (!name) return null;
    try {
        const url = `https://api.openalex.org/authors?search=${encodeURIComponent(name)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            // Helper to match names (same as in main logic)
            const namesMatchHere = (name1, name2) => {
                const n1 = name1.toLowerCase().trim();
                const n2 = name2.toLowerCase().trim();
                if (n1 === n2) return true;
                const parts1 = n1.split(/\s+/);
                const parts2 = n2.split(/\s+/);
                if (parts1.length === 0 || parts2.length === 0) return false;
                if (parts1[0] !== parts2[0]) return false;
                const last1 = parts1[parts1.length - 1];
                const last2 = parts2[parts2.length - 1];
                if (last1 !== last2) return false;
                if (parts1.length === 2 && parts2.length === 2) return true;
                if (parts1.length !== parts2.length) return true;
                for (let i = 1; i < parts1.length - 1; i++) {
                    const p1 = parts1[i].replace('.', '');
                    const p2 = parts2[i].replace('.', '');
                    if (p1.length === 1 && p2.length === 1) {
                        if (p1 !== p2) return false;
                    } else if (p1.length === 1) {
                        if (p1 !== p2.charAt(0)) return false;
                    } else if (p2.length === 1) {
                        if (p2 !== p1.charAt(0)) return false;
                    } else {
                        if (p1 !== p2) return false;
                    }
                }
                return true;
            };

            for (const author of data.results) {
                const authorName = formatNameOrder(author.display_name);
                if (namesMatchHere(authorName, name)) {
                    let institution = 'Unknown';
                    if (author.affiliations && author.affiliations.length > 0) {
                        for (const aff of author.affiliations) {
                            if (aff.institution?.display_name) {
                                institution = aff.institution.display_name;
                                break;
                            }
                        }
                    }
                    return {
                        id: author.id,
                        display_name: authorName,
                        institution: institution
                    };
                }
            }
        }
    } catch (e) {
        console.log(`  ⚠️  Error fetching OpenAlex author by name ${name}: ${e.message}`);
    }
    return null;
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

        console.log('🌐 Fetching data from OpenAlex and ORCID...');
        let oaRes, orcidWorksDetailed;
        try {
            [oaRes, orcidWorksDetailed] = await Promise.all([
                fetch(WORKS_API_URL),
                fetchOrcidWorksDetailed()
            ]);
            
            if (!oaRes.ok) {
                console.warn('⚠️  OpenAlex response not OK. Falling back to existing cache.');
                return;
            }
        } catch (error) {
            console.error('❌ Network error while fetching collaborator data:', error.message);
            if (existingMap.size > 0) {
                console.log('📂 Falling back to existing cache to proceed with build.');
                // Re-save existing data to update the timestamp
                const sorted = Array.from(existingMap.values())
                    .sort((a, b) => b.collaborations - a.collaborations);
                const currentDate = new Date().toISOString();
                const fileContent = `// Auto-generated collaborator data (RECOVERY MODE)
// Last updated: ${currentDate}
const generationDate = '${currentDate}';

const collaborators = ${JSON.stringify(sorted, null, 2)};

export { generationDate };
export default collaborators;
`;
                fs.writeFileSync(OUTPUT_FILE, fileContent);
                return;
            } else {
                throw new Error('No existing cache available and network fetch failed. Build cannot proceed.');
            }
        }

        const orcidDois = new Set(orcidWorksDetailed.keys());
        const works = (await oaRes.json()).results || [];
        const colsMap = new Map();

        // Helper to check if two names should be merged
        const namesMatch = (name1, name2) => {
            const n1 = name1.toLowerCase().trim();
            const n2 = name2.toLowerCase().trim();

            if (n1 === n2) return true;

            const parts1 = n1.split(/\s+/);
            const parts2 = n2.split(/\s+/);

            if (parts1.length < 2 || parts2.length < 2) return false;

            // Helper to match name parts (allowing initials)
            const partMatch = (p1, p2) => {
                const s1 = p1.replace('.', '');
                const s2 = p2.replace('.', '');
                if (s1.length === 1 && s2.length === 1) return s1 === s2;
                if (s1.length === 1) return s1 === s2.charAt(0);
                if (s2.length === 1) return s2 === s1.charAt(0);
                return s1 === s2;
            };

            // Last names must match exactly
            const last1 = parts1[parts1.length - 1];
            const last2 = parts2[parts2.length - 1];
            if (last1 !== last2) return false;

            // First names must match (allowing initials)
            if (!partMatch(parts1[0], parts2[0])) return false;

            // If one has middle name(s) and other doesn't, we consider them a possible match
            // but we should be more careful if they both have middle names
            if (parts1.length !== parts2.length) return true;

            // Both have same number of parts - check if middle names match (including initials)
            for (let i = 1; i < parts1.length - 1; i++) {
                if (!partMatch(parts1[i], parts2[i])) return false;
            }

            return true;
        };

        // Loose name matching (initial + last name) for merging authors in the same paper
        const looseNamesMatch = (name1, name2) => {
            const n1 = name1.toLowerCase().trim();
            const n2 = name2.toLowerCase().trim();
            const parts1 = n1.split(/\s+/);
            const parts2 = n2.split(/\s+/);
            
            if (parts1.length < 2 || parts2.length < 2) return false;
            
            const last1 = parts1[parts1.length - 1];
            const last2 = parts2[parts2.length - 1];
            
            if (last1 !== last2) return false;
            
            // Match if first letter of first name matches
            return parts1[0][0] === parts2[0][0];
        };

        // Helper function to find existing collaborator by name or ORCID
        const findExistingCollaborator = (name, orcid, institution) => {
            // First try to find by ORCID (most reliable)
            if (orcid) {
                for (const [key, entry] of colsMap) {
                    if (entry.orcid && entry.orcid === orcid) {
                        return key;
                    }
                }
            }

            // Then try to find by name matching (first + last + middle initial)
            for (const [key, entry] of colsMap) {
                if (namesMatch(name, entry.name)) {
                    return key;
                }
            }

            return null;
        };

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

            // Merge with ORCID contributors for the current DOI to get missed authors
            if (doi && orcidWorksDetailed.has(doi)) {
                const detailed = orcidWorksDetailed.get(doi);
                const orcidAuthors = await fetchContributorsFromOrcid(detailed.putCode);

                for (const oa of orcidAuthors) {
                    const existingIndex = authors.findIndex(a =>
                        (a.orcid && oa.orcid && a.orcid.includes(oa.orcid.split('/').pop())) ||
                        namesMatch(a.display_name, oa.display_name)
                    );

                    if (existingIndex !== -1) {
                        // Supplement existing author with ORCID if missing
                        if (!authors[existingIndex].orcid && oa.orcid) {
                            authors[existingIndex].orcid = oa.orcid;
                        }
                        // Prefer longer/more complete name
                        if (oa.display_name.length > authors[existingIndex].display_name.length) {
                            authors[existingIndex].display_name = oa.display_name;
                        }
                    } else {
                        // Add new collaborator found only in ORCID
                        // Try to fetch their OpenAlex data by ORCID first, then by name
                        let openAlexData = oa.orcid ? await fetchOpenAlexAuthorByOrcid(oa.orcid) : null;

                        if (!openAlexData && oa.display_name) {
                            openAlexData = await fetchOpenAlexAuthorByName(oa.display_name);
                        }

                        if (openAlexData) {
                            authors.push({
                                id: openAlexData.id,
                                display_name: openAlexData.display_name,
                                orcid: oa.orcid,
                                institution: openAlexData.institution
                            });
                            console.log(`  ✓ Found OpenAlex data for ORCID-only author: ${openAlexData.display_name}`);
                        } else {
                            authors.push({
                                id: null,
                                display_name: oa.display_name,
                                orcid: oa.orcid,
                                institution: 'Unknown'
                            });
                            console.log(`  ⚠️  No OpenAlex data found for ORCID-only author: ${oa.display_name}`);
                        }
                    }
                }
            }

            // Deduplicate authors for this work (loose name matching)
            const uniqueWorkAuthors = [];
            for (const a of authors) {
                const existingIndex = uniqueWorkAuthors.findIndex(ua =>
                    (ua.orcid && a.orcid && ua.orcid === a.orcid) ||
                    (ua.id && a.id && ua.id === a.id) ||
                    looseNamesMatch(ua.display_name, a.display_name)
                );

                if (existingIndex !== -1) {
                    const existing = uniqueWorkAuthors[existingIndex];
                    // Supplement existing author data
                    if (!existing.orcid && a.orcid) existing.orcid = a.orcid;
                    if (!existing.id && a.id) existing.id = a.id;
                    // Prefer longer/more complete name (if not null)
                    if (a.display_name && (!existing.display_name || a.display_name.length > existing.display_name.length)) {
                        existing.display_name = a.display_name;
                    }
                    // Prefer better institution data
                    if (existing.institution === 'Unknown' && a.institution !== 'Unknown') {
                        existing.institution = a.institution;
                    }
                } else {
                    uniqueWorkAuthors.push(a);
                }
            }
            authors = uniqueWorkAuthors;

            for (const a of authors) {
                if (a.orcid && a.orcid.includes(USER_ORCID)) continue;
                if (a.display_name.toLowerCase() === 'aritra roy') continue;
                if (a.display_name.toLowerCase().includes('aritra roy') && a.display_name.length < 15) continue;

                const inst = a.institution;

                // Try to find existing collaborator
                const existingKey = findExistingCollaborator(a.display_name, a.orcid, inst);

                if (existingKey) {
                    const e = colsMap.get(existingKey);
                    if (!e.dois.some(d => d.title === w.title)) {
                        e.collaborations++;
                        e.dois.push({ doi: w.doi || doi, title: w.title });
                    }
                    if (yr > e.latestPaperYear) {
                        e.latestPaperYear = yr;
                        if (inst !== 'Unknown') e.openAlexAffiliation = inst;
                    }
                    // Update ORCID if we didn't have it before
                    if (!e.orcid && a.orcid) {
                        e.orcid = a.orcid;
                    }
                    // Update OpenAlex ID if we didn't have it before
                    if (!e.id && a.id) {
                        e.id = a.id;
                    }
                    // Prefer better name (longer/more complete)
                    if (a.display_name.length > e.name.length) {
                        e.name = a.display_name;
                    }
                    // Prefer better institution data
                    if (e.openAlexAffiliation === 'Unknown' && inst !== 'Unknown') {
                        e.openAlexAffiliation = inst;
                    }
                } else {
                    // Create new entry - use ORCID as key if available, otherwise use OpenAlex ID, otherwise use name
                    const newKey = a.orcid || a.id || `name:${a.display_name}`;
                    colsMap.set(newKey, {
                        id: a.id,
                        name: a.display_name,
                        orcid: a.orcid,
                        openAlexAffiliation: inst,
                        latestPaperYear: yr,
                        collaborations: 1,
                        dois: [{ doi: w.doi || doi, title: w.title }]
                    });
                }
            }
        }

        console.log(`👥 Found ${colsMap.size} unique collaborators`);

        // Helper to find cached entry by ORCID, OpenAlex ID, or name
        const findCachedEntry = (c, existingMap) => {
            // Try ORCID first
            if (c.orcid) {
                for (const [key, entry] of existingMap) {
                    if (entry.orcid === c.orcid) return entry;
                }
            }
            // Try OpenAlex ID
            if (c.id) {
                const byId = existingMap.get(c.id);
                if (byId) return byId;
            }
            // Try by name matching (first + last + middle initial)
            for (const [key, entry] of existingMap) {
                if (namesMatch(c.name, entry.name)) {
                    return entry;
                }
            }
            return null;
        };

        const results = [];
        for (const [id, c] of colsMap) {
            const cached = findCachedEntry(c, existingMap);

            if (cached && cached.collaborationAffiliation && cached.currentAffiliation) {
                const isManuallyUpdated = cached.updatedManually === true;
                const needsFullUpdate = shouldFullUpdate && !isManuallyUpdated;

                if (!needsFullUpdate) {
                    // Check if manual override data exists for the institutions
                    const manualCollOverride = manualInstitutes.find(i =>
                        i.name.toLowerCase() === cached.collaborationAffiliation.name.toLowerCase()
                    );
                    const manualCurrOverride = manualInstitutes.find(i =>
                        i.name.toLowerCase() === cached.currentAffiliation.name.toLowerCase()
                    );

                    let collaborationAffiliation = cached.collaborationAffiliation;
                    let currentAffiliation = cached.currentAffiliation;
                    let institutionOverridden = false;

                    if (manualCollOverride) {
                        collaborationAffiliation = {
                            name: manualCollOverride.name,
                            city: manualCollOverride.city,
                            country: manualCollOverride.country,
                            latitude: manualCollOverride.latitude,
                            longitude: manualCollOverride.longitude
                        };
                        institutionOverridden = true;
                        console.log(`  📝 Applying manual override to cached collaboration: ${cached.name}`);
                    }

                    if (manualCurrOverride) {
                        currentAffiliation = {
                            name: manualCurrOverride.name,
                            city: manualCurrOverride.city,
                            country: manualCurrOverride.country,
                            latitude: manualCurrOverride.latitude,
                            longitude: manualCurrOverride.longitude
                        };
                        institutionOverridden = true;
                        console.log(`  📝 Applying manual override to cached current affiliation: ${cached.name}`);
                    }

                    console.log(`📋 Using Cached: ${cached.name}${isManuallyUpdated || institutionOverridden ? ' (manually maintained)' : ''}`);

                    // Build cached collaborator object
                    let cachedCollaboratorData = {
                        id: c.id,
                        name: cached.name,
                        orcid: c.orcid,
                        collaborations: c.collaborations,
                        dois: c.dois,
                        latestPaperYear: c.latestPaperYear,
                        collaborationAffiliation,
                        currentAffiliation,
                        updatedManually: isManuallyUpdated || institutionOverridden
                    };

                    // Apply manual collaborator overrides if they exist
                    if (c.id) {
                        const manualOverride = manualCollaborators.find(mc => mc.id === c.id);
                        if (manualOverride) {
                            console.log(`  📝 Applying manual collaborator override for: ${c.id}`);
                            
                            // Name override
                            if (manualOverride.name === "") {
                                cachedCollaboratorData.name = null;
                            } else if (manualOverride.name !== null && manualOverride.name !== undefined) {
                                cachedCollaboratorData.name = manualOverride.name;
                            }

                            // ORCID override
                            if (manualOverride.orcid === "") {
                                cachedCollaboratorData.orcid = null;
                            } else if (manualOverride.orcid !== null && manualOverride.orcid !== undefined) {
                                cachedCollaboratorData.orcid = manualOverride.orcid;
                            }

                            // Collaborations override
                            if (manualOverride.collaborations === "") {
                                cachedCollaboratorData.collaborations = null;
                            } else if (manualOverride.collaborations !== null && manualOverride.collaborations !== undefined) {
                                cachedCollaboratorData.collaborations = manualOverride.collaborations;
                            }

                            // LatestPaperYear override
                            if (manualOverride.latestPaperYear === "") {
                                cachedCollaboratorData.latestPaperYear = null;
                            } else if (manualOverride.latestPaperYear !== null && manualOverride.latestPaperYear !== undefined) {
                                cachedCollaboratorData.latestPaperYear = manualOverride.latestPaperYear;
                            }
                            
                            // Affiliation overrides
                            if (manualOverride.collaborationAffiliation === "") {
                                cachedCollaboratorData.collaborationAffiliation = { name: null, city: null, country: null, latitude: null, longitude: null, manual: true };
                            } else if (manualOverride.collaborationAffiliation !== null && manualOverride.collaborationAffiliation !== undefined) {
                                cachedCollaboratorData.collaborationAffiliation = await getInstitutionalDetails(manualOverride.collaborationAffiliation);
                            }

                            if (manualOverride.currentAffiliation === "") {
                                cachedCollaboratorData.currentAffiliation = { name: null, city: null, country: null, latitude: null, longitude: null, manual: true };
                            } else if (manualOverride.currentAffiliation !== null && manualOverride.currentAffiliation !== undefined) {
                                cachedCollaboratorData.currentAffiliation = await getInstitutionalDetails(manualOverride.currentAffiliation);
                            }

                            cachedCollaboratorData.updatedManually = true;
                        }
                    }

                    results.push(cachedCollaboratorData);
                    continue;
                }
            }

            const { bestName, affiliations: currentAffiliations } = await determineLatestAffiliations(c.orcid, c.openAlexAffiliation, c.latestPaperYear, c.id);
            const finalName = bestName || c.name;
            console.log(`👤 Processing Collaborator: ${finalName} (OpenAlex ID: ${c.id || 'None'}, ORCID: ${c.orcid || 'None'})`);

            let collaborationAffiliation = null;
            let currentAffiliation = null;
            let institutionOverridden = false;

            // 1. Handle Collaboration Affiliation (from the OpenAlex work)
            const collAffName = c.openAlexAffiliation;
            if (collAffName && collAffName !== 'Unknown') {
                const details = await getInstitutionalDetails(collAffName);
                collaborationAffiliation = details;
                if (details.manual) institutionOverridden = true;
                if (collaborationAffiliation && collaborationAffiliation.latitude) {
                    console.log(`  📍 Collaboration Institution: ${collAffName} [${collaborationAffiliation.latitude}, ${collaborationAffiliation.longitude}]`);
                }
            }

            // Fallback for Collaboration Affiliation using Profile/ORCID data if OA work affiliation is unknown
            if ((!collaborationAffiliation || collaborationAffiliation.name === 'Unknown') && currentAffiliations && currentAffiliations.length > 0) {
                const affOpt = currentAffiliations[0];
                const affName = typeof affOpt === 'string' ? affOpt : affOpt.name;
                const countryCode = typeof affOpt === 'object' ? affOpt.countryCode : null;
                const details = await getInstitutionalDetails(affName, countryCode);
                collaborationAffiliation = details;
                if (details.manual) institutionOverridden = true;
                if (collaborationAffiliation && collaborationAffiliation.latitude) {
                    console.log(`  📍 Collaboration Institution (from Profile/ORCID): ${affName} [${collaborationAffiliation.latitude}, ${collaborationAffiliation.longitude}]`);
                }
            }

            // Ensure we have at least an 'Unknown' object if everything failed
            if (!collaborationAffiliation) {
                collaborationAffiliation = { name: 'Unknown', city: null, country: null, latitude: null, longitude: null, manual: false };
            }

            // 2. Handle Current Affiliation
            if (currentAffiliations && currentAffiliations.length > 0) {
                for (const affOpt of currentAffiliations) {
                    const affName = typeof affOpt === 'string' ? affOpt : affOpt.name;
                    const countryCode = typeof affOpt === 'object' ? affOpt.countryCode : null;
                    const details = await getInstitutionalDetails(affName, countryCode);
                    currentAffiliation = details;
                    if (details.manual) institutionOverridden = true;
                    if (details && details.latitude) {
                        console.log(`  🏠 Current Institution: ${affName} [${details.latitude}, ${details.longitude}]`);
                        break;
                    }
                }
            }

            if (!currentAffiliation && collaborationAffiliation) {
                currentAffiliation = { ...collaborationAffiliation };
            }

            // Build the collaborator object
            let collaboratorData = {
                id: c.id,
                name: finalName,
                orcid: c.orcid,
                collaborations: c.collaborations,
                dois: c.dois,
                latestPaperYear: c.latestPaperYear,
                collaborationAffiliation: collaborationAffiliation || { name: 'Unknown', city: null, country: null, latitude: null, longitude: null, manual: false },
                currentAffiliation: currentAffiliation || { name: 'Unknown', city: null, country: null, latitude: null, longitude: null, manual: false },
                updatedManually: institutionOverridden
            };

            // Apply manual collaborator overrides if they exist
            if (c.id) {
                const manualOverride = manualCollaborators.find(mc => mc.id === c.id);
                if (manualOverride) {
                    console.log(`  📝 Applying manual override for collaborator: ${c.id}`);
                    
                    // Name override
                    if (manualOverride.name === "") {
                        collaboratorData.name = null;
                    } else if (manualOverride.name !== null && manualOverride.name !== undefined) {
                        collaboratorData.name = manualOverride.name;
                    }

                    // ORCID override
                    if (manualOverride.orcid === "") {
                        collaboratorData.orcid = null;
                    } else if (manualOverride.orcid !== null && manualOverride.orcid !== undefined) {
                        collaboratorData.orcid = manualOverride.orcid;
                    }

                    // Collaborations override
                    if (manualOverride.collaborations === "") {
                        collaboratorData.collaborations = null;
                    } else if (manualOverride.collaborations !== null && manualOverride.collaborations !== undefined) {
                        collaboratorData.collaborations = manualOverride.collaborations;
                    }

                    // LatestPaperYear override
                    if (manualOverride.latestPaperYear === "") {
                        collaboratorData.latestPaperYear = null;
                    } else if (manualOverride.latestPaperYear !== null && manualOverride.latestPaperYear !== undefined) {
                        collaboratorData.latestPaperYear = manualOverride.latestPaperYear;
                    }

                    // Affiliation overrides
                    if (manualOverride.collaborationAffiliation === "") {
                        collaboratorData.collaborationAffiliation = { name: null, city: null, country: null, latitude: null, longitude: null, manual: true };
                    } else if (manualOverride.collaborationAffiliation !== null && manualOverride.collaborationAffiliation !== undefined) {
                        collaboratorData.collaborationAffiliation = await getInstitutionalDetails(manualOverride.collaborationAffiliation);
                    }

                    if (manualOverride.currentAffiliation === "") {
                        collaboratorData.currentAffiliation = { name: null, city: null, country: null, latitude: null, longitude: null, manual: true };
                    } else if (manualOverride.currentAffiliation !== null && manualOverride.currentAffiliation !== undefined) {
                        collaboratorData.currentAffiliation = await getInstitutionalDetails(manualOverride.currentAffiliation);
                    }

                    collaboratorData.updatedManually = true;
                }
            }

            results.push(collaboratorData);
        }

        const sorted = results
            .filter(c => c.name !== null && c.name !== undefined)
            .sort((a, b) => b.collaborations - a.collaborations);
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