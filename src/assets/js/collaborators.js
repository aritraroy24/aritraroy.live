import collaboratorsDataStatic, { generationDate } from './data/collaborations-cache.js';
import manualInstitutes from './data/collected/collected-institutional-data.js';
import manualCollaborators from './data/collected/collected-collaborator-data.js';

// OpenAlex API Configuration
const USER_ORCID = '0000-0003-0243-9124';
const WORKS_API_URL = `https://api.openalex.org/works?filter=authorships.author.orcid:${USER_ORCID}&per_page=200`;
const ORCID_WORKS_API = `https://pub.orcid.org/v3.0/${USER_ORCID}/works`;

// Geocoding APIs
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';
const PHOTON_API = 'https://photon.komoot.io/api/';
const LOCALSTORAGE_KEY = 'collaborators-cache';

// Load static cache from imported file
async function loadStaticCache() {
    return collaboratorsDataStatic || [];
}

// Load from browser storage
function loadLocalStorageCache() {
    try {
        const stored = localStorage.getItem(LOCALSTORAGE_KEY);
        if (stored) return JSON.parse(stored);
    } catch (e) { }
    return null;
}

// Save to browser storage
function saveToLocalStorage(collaborators) {
    try {
        const cacheData = {
            version: "1.0",
            generationDate: generationDate, // Use static cache generation date
            lastUpdated: new Date().toISOString(), // Keep for runtime fetch tracking
            collaborators: collaborators
        };
        localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(cacheData));
    } catch (e) { }
}

// Rate limiting for geocoding
let lastGeocodingRequest = 0;
async function rateLimitedDelay() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastGeocodingRequest;
    if (timeSinceLastRequest < 1000) {
        await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastRequest));
    }
    lastGeocodingRequest = Date.now();
}

async function geocodeWithPhoton(institutionName, countryCode) {
    try {
        await rateLimitedDelay();
        const searchQuery = countryCode ? `${institutionName}, ${countryCode}` : institutionName;
        const url = `${PHOTON_API}?q=${encodeURIComponent(searchQuery)}&limit=1&lang=en`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        if (data?.features?.length > 0) {
            const f = data.features[0];
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

async function geocodeInstitution(name, countryCode) {
    if (!name || name === 'Unknown') return null;
    try {
        await rateLimitedDelay();
        const query = countryCode ? `${name}, ${countryCode}` : name;
        const url = `${NOMINATIM_API}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1&accept-language=en`;
        const response = await fetch(url, { headers: { 'User-Agent': 'AstroPortfolio' } });
        if (response.ok) {
            const data = await response.json();
            if (data?.length > 0) {
                const res = {
                    latitude: parseFloat(data[0].lat),
                    longitude: parseFloat(data[0].lon),
                    city: data[0].address?.city || data[0].address?.town || null,
                    country: data[0].address?.country || null
                };
                if (!isNaN(res.latitude)) return res;
            }
        }
    } catch (e) { }
    return await geocodeWithPhoton(name, countryCode);
}

async function getInstitutionalDetails(name, countryCode = null) {
    if (!name || name === 'Unknown') {
        return { name: 'Unknown', city: null, country: null, latitude: null, longitude: null, manual: false };
    }

    // Check manual data first
    const manualData = manualInstitutes.find(i =>
        i.name.toLowerCase() === name.toLowerCase()
    );

    if (manualData) {
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

function selectBestName(names) {
    if (!names || names.length === 0) return null;
    const cleanNames = [...new Set(names.filter(n => n && typeof n === 'string' && !n.startsWith('None ')))]
        .map(n => n.trim());
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

// Determine latest institution across all 4 sources
async function determineLatestAffiliations(orcidUrl, openAlexAuthorId) {
    let candidates = [];
    let bestNameFromOA = null;

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
            }
        } catch (e) { }
    }

    if (orcidUrl) {
        try {
            const orcidId = orcidUrl.split('/').pop();
            const headers = { 'Accept': 'application/json' };
            const [empRes, eduRes] = await Promise.all([
                fetch(`https://pub.orcid.org/v3.0/${orcidId}/employments`, { headers }),
                fetch(`https://pub.orcid.org/v3.0/${orcidId}/educations`, { headers })
            ]);
            if (empRes.ok) {
                const d = await empRes.json();
                (d['affiliation-group'] || []).forEach(g => {
                    const s = g['summaries']?.[0]?.['employment-summary'];
                    if (s) candidates.push({
                        name: s.organization?.name,
                        year: s['start-date'] ? parseInt(s['start-date'].year.value) : 0,
                        isCurrent: !s['end-date'], priority: 3
                    });
                });
            }
            if (eduRes.ok) {
                const d = await eduRes.json();
                (d['affiliation-group'] || []).forEach(g => {
                    const s = g['summaries']?.[0]?.['education-summary'];
                    if (s) candidates.push({
                        name: s.organization?.name,
                        year: s['start-date'] ? parseInt(s['start-date'].year.value) : 0,
                        isCurrent: !s['end-date'], priority: 2
                    });
                });
            }
        } catch (e) { }
    }
    
    let uniqueAffiliations = [];
    if (candidates.length > 0) {
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
        currentAffiliations: uniqueAffiliations
    };
}

async function fetchOrcidDois() {
    try {
        const response = await fetch(ORCID_WORKS_API, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) return new Set();
        const data = await response.json();
        const validDois = new Set();
        (data.group || []).forEach(g => {
            (g['work-summary'] || []).forEach(s => {
                (s['external-ids']?.['external-id'] || []).forEach(id => {
                    if (id['external-id-type'] === 'doi') {
                        validDois.add(id['external-id-value'].toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim());
                    }
                });
            });
        });
        return validDois;
    } catch (e) { return new Set(); }
}

async function fetchCollaborators() {
    const loader = document.getElementById('collaborators-loader');
    const container = document.getElementById('collaborators-container');
    if (!loader || !container) return;

    try {
        const staticCache = await loadStaticCache();
        const localCacheData = loadLocalStorageCache();
        const localCols = localCacheData?.collaborators || [];

        const masterCacheMap = new Map();
        staticCache.forEach(c => masterCacheMap.set(c.id || c.name, c));
        localCols.forEach(c => {
            const ext = masterCacheMap.get(c.id || c.name);
            if (!ext || (c.latitude && c.longitude)) {
                // Preserve updatedManually flag from static cache if it exists
                if (ext && ext.updatedManually !== undefined) {
                    c.updatedManually = ext.updatedManually;
                }
                masterCacheMap.set(c.id || c.name, c);
            }
        });

        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        // Use static cache generation date to determine if data is stale
        const cacheGenTime = generationDate ? new Date(generationDate).getTime() : 0;
        const expired = (Date.now() - cacheGenTime) > THIRTY_DAYS;

        if (!expired && localCacheData && localCols.length > 0) {
            const list = Array.from(masterCacheMap.values()).sort((a, b) => b.collaborations - a.collaborations);
            renderCollaborators(list, container, loader);
            return;
        }

        const [oaRes, orcidDois] = await Promise.all([
            fetch(WORKS_API_URL).catch(() => ({ ok: false })),
            fetchOrcidDois()
        ]);
        if (!oaRes.ok) throw new Error();
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

        const finalProcessed = [];
        for (const [id, c] of colsMap) {
            // Check cache first to avoid expensive API calls
            const cached = masterCacheMap.get(id) || masterCacheMap.get(c.name);
            
            if (cached && cached.collaborationAffiliation && cached.currentAffiliation) {
                let collaborationAffiliation = cached.collaborationAffiliation;
                let currentAffiliation = cached.currentAffiliation;
                let institutionOverridden = false;

                // Apply manual institution overrides to cached data
                const manualColl = manualInstitutes.find(i => i.name.toLowerCase() === collaborationAffiliation.name.toLowerCase());
                if (manualColl) {
                    collaborationAffiliation = { ...manualColl };
                    institutionOverridden = true;
                }
                const manualCurr = manualInstitutes.find(i => i.name.toLowerCase() === currentAffiliation.name.toLowerCase());
                if (manualCurr) {
                    currentAffiliation = { ...manualCurr };
                    institutionOverridden = true;
                }

                let finalData = {
                    id: c.id,
                    name: cached.name,
                    orcid: c.orcid,
                    collaborations: c.collaborations,
                    dois: c.dois,
                    latestPaperYear: c.latestPaperYear,
                    collaborationAffiliation,
                    currentAffiliation,
                    updatedManually: (cached.updatedManually || institutionOverridden) || false
                };

                // Apply manual collaborator overrides
                if (c.id) {
                    const manualOverride = manualCollaborators.find(mc => mc.id === c.id);
                    if (manualOverride) {
                        // Name override
                        if (manualOverride.name === "") {
                            finalData.name = null;
                        } else if (manualOverride.name !== null && manualOverride.name !== undefined) {
                            finalData.name = manualOverride.name;
                        }

                        // ORCID override
                        if (manualOverride.orcid === "") {
                            finalData.orcid = null;
                        } else if (manualOverride.orcid !== null && manualOverride.orcid !== undefined) {
                            finalData.orcid = manualOverride.orcid;
                        }

                        // Collaborations override
                        if (manualOverride.collaborations === "") {
                            finalData.collaborations = null;
                        } else if (manualOverride.collaborations !== null && manualOverride.collaborations !== undefined) {
                            finalData.collaborations = manualOverride.collaborations;
                        }

                        // LatestPaperYear override
                        if (manualOverride.latestPaperYear === "") {
                            finalData.latestPaperYear = null;
                        } else if (manualOverride.latestPaperYear !== null && manualOverride.latestPaperYear !== undefined) {
                            finalData.latestPaperYear = manualOverride.latestPaperYear;
                        }
                        
                        // Affiliation overrides
                        if (manualOverride.collaborationAffiliation === "") {
                            finalData.collaborationAffiliation = { name: null, city: null, country: null, latitude: null, longitude: null, manual: true };
                        } else if (manualOverride.collaborationAffiliation !== null && manualOverride.collaborationAffiliation !== undefined) {
                            finalData.collaborationAffiliation = await getInstitutionalDetails(manualOverride.collaborationAffiliation);
                        }

                        if (manualOverride.currentAffiliation === "") {
                            finalData.currentAffiliation = { name: null, city: null, country: null, latitude: null, longitude: null, manual: true };
                        } else if (manualOverride.currentAffiliation !== null && manualOverride.currentAffiliation !== undefined) {
                            finalData.currentAffiliation = await getInstitutionalDetails(manualOverride.currentAffiliation);
                        }

                        finalData.updatedManually = true;
                    }
                }

                finalProcessed.push(finalData);
                continue;
            }

            const { bestName, currentAffiliations } = await determineLatestAffiliations(c.orcid, c.id);
            const finalName = bestName || c.name;

            let collaborationAffiliation = null;
            let currentAffiliation = null;
            let institutionOverridden = false;

            // 1. Handle Collaboration Affiliation
            const collAffName = c.openAlexAffiliation;
            if (collAffName && collAffName !== 'Unknown') {
                const details = await getInstitutionalDetails(collAffName);
                collaborationAffiliation = details;
                if (details.manual) institutionOverridden = true;
            }

            // 2. Handle Current Affiliation
            if (currentAffiliations && currentAffiliations.length > 0) {
                for (const affOpt of currentAffiliations) {
                    const affName = typeof affOpt === 'string' ? affOpt : affOpt.name;
                    const countryCode = typeof affOpt === 'object' ? affOpt.countryCode : null;
                    const details = await getInstitutionalDetails(affName, countryCode);
                    if (details && details.latitude) {
                        currentAffiliation = details;
                        if (details.manual) institutionOverridden = true;
                        break;
                    }
                }
            }

            if (!currentAffiliation && collaborationAffiliation) {
                currentAffiliation = { ...collaborationAffiliation };
            }

            if (collaborationAffiliation) {
                let collaboratorData = {
                    id: c.id,
                    name: finalName,
                    orcid: c.orcid,
                    collaborations: c.collaborations,
                    dois: c.dois,
                    latestPaperYear: c.latestPaperYear,
                    collaborationAffiliation,
                    currentAffiliation,
                    updatedManually: institutionOverridden
                };

                // Apply manual collaborator overrides
                if (c.id) {
                    const manualOverride = manualCollaborators.find(mc => mc.id === c.id);
                    if (manualOverride) {
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

                finalProcessed.push(collaboratorData);
            }
        }

        const sorted = finalProcessed.sort((a, b) => b.collaborations - a.collaborations);
        saveToLocalStorage(sorted);
        renderCollaborators(sorted, container, loader);
    } catch (e) {
        loader.style.display = 'none';
        container.innerHTML = '<p class="error-message">Unable to load collaborators.</p>';
    }
}

function renderCollaborators(list, container, loader) {
    const fragment = document.createDocumentFragment();
    list.forEach(c => fragment.appendChild(createCollaboratorCard(c)));
    
    container.innerHTML = '';
    container.appendChild(fragment);
    loader.style.display = 'none';
}

function createCollaboratorCard(c) {
    const card = document.createElement('div');
    card.className = 'collaborator-card';
    
    const coll = c.collaborationAffiliation;
    const curr = c.currentAffiliation;
    const aff = (coll?.name && coll?.latitude && coll?.longitude) ? coll : (curr || coll);
    
    const flag = getCountryFlag(aff?.country);
    const locationText = aff?.city 
        ? `${aff.city}, ${aff.country || ''}` 
        : (aff?.country || '');

    card.innerHTML = `
        <div class="collaborator-content">
            <div class="collaborator-header">
                <h2 class="collaborator-name">${c.name}</h2>
                <div class="collaborator-links">
                    ${c.orcid ? `<a href="${c.orcid}" target="_blank" class="orcid-link"><svg width="16" height="16" viewBox="0 0 256 256"><path fill="currentColor" d="M256,128c0,70.7-57.3,128-128,128C57.3,256,0,198.7,0,128C0,57.3,57.3,0,128,0C198.7,0,256,57.3,256,128z"/><path fill="#fff" d="M86.3,186.2H70.9V79.1h15.4v48.4V186.2z"/><path fill="#fff" d="M108.9,79.1h41.6c39.6,0,57,28.3,57,53.6c0,27.5-21.5,53.6-56.8,53.6h-41.8V79.1z M124.3,172.4h24.5c34.9,0,42.9-26.5,42.9-39.7c0-21.5-13.7-39.7-43.7-39.7h-23.7V172.4z"/><circle fill="#fff" cx="78.2" cy="59" r="10"/></svg></a>` : ''}
                </div>
            </div>
            <div class="collaborator-info">
                <div class="collaborator-affiliation">${flag ? `<span class="country-flag">${flag}</span>` : ''}<span>${aff?.name || 'Unknown'}</span></div>
                ${locationText ? `<div class="collaborator-location"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg><span>${locationText}</span></div>` : ''}
                <div class="collaboration-count"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5zm2-1a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zM0 13a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 16 13V6a1.5 1.5 0 0 0-1.5-1.5h-13A1.5 1.5 0 0 0 0 6v7zm1.5.5A.5.5 0 0 1 1 13V6a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-13z"/></svg><span>${c.collaborations} ${c.collaborations === 1 ? 'publication' : 'publications'}</span></div>
            </div>
        </div>`;
    return card;
}

function getCountryFlag(code) {
    if (!code) return '';
    return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt()));
}

document.addEventListener('DOMContentLoaded', fetchCollaborators);
