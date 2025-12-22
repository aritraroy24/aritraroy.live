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

function selectBestName(names) {
    if (!names || names.length === 0) return null;
    const cleanNames = [...new Set(names.filter(n => n && typeof n === 'string'))];
    if (cleanNames.length === 0) return null;

    const countInitials = (s) => {
        if (!s) return 999;
        const matches = s.match(/\b\w\b\.?/g) || [];
        return matches.length;
    };

    return cleanNames.reduce((best, current) => {
        const currentInitials = countInitials(current);
        const bestInitials = countInitials(best);
        if (currentInitials < bestInitials) return current;
        if (currentInitials === bestInitials && current.length > best.length) return current;
        return best;
    }, cleanNames[0]);
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
    } else {
        console.log(`  ⚠️  No OpenAlex author ID provided`);
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

async function fetchOrcidDois() {
    try {
        const res = await fetch(ORCID_WORKS_API, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return new Set();
        const d = await res.json();
        const Dois = new Set();
        (d.group || []).forEach(g => (g['work-summary'] || []).forEach(s => (s['external-ids']?.['external-id'] || []).forEach(id => {
            if (id['external-id-type'] === 'doi') {
                const doiVal = id['external-id-value'].toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
                Dois.add(doiVal);
            }
        })));
        return Dois;
    } catch (e) { return new Set(); }
}

async function loadExisting() {
    if (!fs.existsSync(OUTPUT_FILE)) return new Map();
    try {
        const c = fs.readFileSync(OUTPUT_FILE, 'utf8');
        const m = c.match(/const collaborators = ([\s\S]*?);/);
        if (m) return new Map(JSON.parse(m[1]).map(x => [x.id || x.name, x]));
    } catch (e) { }
    return new Map();
}

async function generate() {
    console.log('🚀 Generating Cache...');
    try {
        const [oaRes, orcidDois, existingMap] = await Promise.all([fetch(WORKS_API_URL), fetchOrcidDois(), loadExisting()]);
        if (!oaRes.ok) throw new Error('OpenAlex Response not OK');
        const works = (await oaRes.json()).results || [];
        const colsMap = new Map();

        for (const w of works) {
            const yr = w.publication_year || 0;
            const doi = w.doi?.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
            if (orcidDois.size > 0 && (!doi || !orcidDois.has(doi))) continue;
            for (const auth of (w.authorships || [])) {
                const a = auth.author;
                if (!a || (a.orcid && a.orcid.includes(USER_ORCID))) continue;
                
                const authorId = a.id || a.orcid || a.display_name;
                const inst = auth.institutions?.[0]?.display_name || 'Unknown';
                
                if (colsMap.has(authorId)) {
                    const e = colsMap.get(authorId);
                    if (!e.dois.some(d => d.title === w.title)) {
                        e.collaborations++;
                        e.dois.push({ doi: w.doi || doi, title: w.title });
                    }
                    if (yr > e.latestPaperYear) {
                        e.latestPaperYear = yr;
                        e.openAlexAffiliation = inst;
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
            const { bestName, affiliations: affiliationOptions } = await determineLatestAffiliations(c.orcid, c.openAlexAffiliation, c.latestPaperYear, c.id);
            
            if (bestName) {
                c.name = bestName;
            }

            if (!affiliationOptions || affiliationOptions.length === 0 || (affiliationOptions[0]?.name === 'Unknown' || affiliationOptions[0] === 'Unknown')) continue;

            let foundGeo = false;

            // Check cache for any of the affiliation options
            for (const affOpt of affiliationOptions) {
                const affName = typeof affOpt === 'string' ? affOpt : affOpt.name;
                const cached = existingMap.get(id) || existingMap.get(c.name);
                if (cached?.latitude && cached.affiliation === affName) {
                    console.log(`Using Cached: ${c.name}`);
                    c.affiliation = affName;
                    Object.assign(c, { latitude: cached.latitude, longitude: cached.longitude, city: cached.city, country: cached.country });
                    foundGeo = true;
                    break;
                }
            }

            // If not in cache, try geocoding all options
            if (!foundGeo) {
                console.log(`👤 Processing: ${c.name}`);
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
            }

            if (c.affiliation) results.push(c);
        }

        const sorted = results.sort((a, b) => b.collaborations - a.collaborations);
        const fileContent = `const collaborators = ${JSON.stringify(sorted, null, 2)};\n\nexport default collaborators;`;
        fs.writeFileSync(OUTPUT_FILE, fileContent);
        console.log(`✅ Done! Saved ${sorted.length} collaborators to ${OUTPUT_FILE}`);
    } catch (e) { console.error('❌ Error:', e); }
}

generate();