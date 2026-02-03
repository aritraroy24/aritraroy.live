import collaboratorsDataStatic, { generationDate } from './data/collaborations-cache.js';

// Configuration
const LOCALSTORAGE_KEY = 'collaborators_cache_v2';
const TIMESTAMP_KEY = 'collaborators_timestamp_v2';

// Get collaborators (preferring localStorage, falling back to static)
function getCollaborators() {
    try {
        const localCached = localStorage.getItem(LOCALSTORAGE_KEY);
        const localTimestamp = localStorage.getItem(TIMESTAMP_KEY);

        if (localCached && localTimestamp) {
            const localDate = new Date(localTimestamp);
            const staticDate = new Date(generationDate);

            if (localDate >= staticDate) {
                console.log('✓ Loaded collaborators from localStorage');
                return JSON.parse(localCached);
            }
        }

        console.log('✓ Loaded collaborators from static cache');
        saveToLocalStorage(collaboratorsDataStatic);
        return collaboratorsDataStatic;
    } catch (e) {
        console.error('Error reading cache:', e);
        return collaboratorsDataStatic || [];
    }
}

// Save to browser storage
function saveToLocalStorage(collaborators) {
    try {
        localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(collaborators));
        localStorage.setItem(TIMESTAMP_KEY, generationDate || new Date().toISOString());
    } catch (e) {
        console.warn('Error saving to cache (likely quota exceeded):', e);
    }
}

async function displayCollaborators() {
    const loader = document.getElementById('collaborators-loader');
    const container = document.getElementById('collaborators-container');
    if (!loader || !container) return;

    try {
        const collaborators = getCollaborators();
        
        if (!collaborators || collaborators.length === 0) {
            loader.style.display = 'none';
            container.innerHTML = '<p class="no-data">No collaborators found.</p>';
            return;
        }

        renderCollaborators(collaborators, container, loader);
    } catch (e) {
        console.error('Error displaying collaborators:', e);
        loader.style.display = 'none';
        container.innerHTML = '<p class="error-message">Unable to load collaborators.</p>';
    }
}

function renderCollaborators(list, container, loader) {
    const fragment = document.createDocumentFragment();
    list.forEach(c => {
        if (c.name) {
            fragment.appendChild(createCollaboratorCard(c));
        }
    });
    
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
    if (!code || code.length !== 2) return '';
    return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt()));
}

document.addEventListener('DOMContentLoaded', displayCollaborators);
