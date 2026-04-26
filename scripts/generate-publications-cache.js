// Node.js script to pre-generate publications data from ORCID
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const ORCID_ID = '0000-0003-0243-9124';
const USER_NAME = 'Aritra Roy';
const DATA_DIR = path.join(__dirname, '../src/assets/js/data');
const OUTPUT_FILE = path.join(DATA_DIR, 'publications-cache.js');

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
});

async function fetchFromORCID() {
    console.log(`🚀 Fetching publications from ORCID (${ORCID_ID})...`);
    try {
        const response = await fetch(`https://pub.orcid.org/v3.0/${ORCID_ID}/works`, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`ORCID API returned status ${response.status}`);
        }

        const data = await response.json();
        return data.group || [];
    } catch (error) {
        console.error('❌ Error fetching from ORCID:', error);
        return [];
    }
}

async function fetchCrossrefMetadata(doi) {
    if (!doi) return null;
    try {
        const response = await fetch(`https://api.crossref.org/works/${doi}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.message;
    } catch (error) {
        console.error(`❌ Error fetching Crossref metadata for DOI ${doi}:`, error);
        return null;
    }
}

async function fetchArxivMetadata(arxivId) {
    if (!arxivId) return null;
    try {
        const cleanId = arxivId.replace(/^arXiv:/i, '').trim();
        const apiUrl = `https://export.arxiv.org/api/query?id_list=${cleanId}`;
        const response = await fetch(apiUrl);
        if (!response.ok) return null;

        const xmlText = await response.text();
        const jsonObj = parser.parse(xmlText);
        const entry = jsonObj.feed?.entry;

        if (!entry) return null;

        const authors = (Array.isArray(entry.author) ? entry.author : [entry.author]).map(author => {
            const fullName = author.name;
            const nameParts = fullName.split(/\s+/);
            const family = nameParts[nameParts.length - 1];
            const given = nameParts.slice(0, -1).join(' ');
            return { given, family };
        });

        return {
            type: 'arxiv',
            title: entry.title?.trim(),
            author: authors,
            'container-title': ['arXiv Preprint'],
            year: entry.published ? new Date(entry.published).getFullYear().toString() : '',
            publisher: 'arXiv',
            arxivId: cleanId,
            primaryClass: entry.primary_category?.term || ''
        };
    } catch (error) {
        console.error(`❌ Error fetching arXiv metadata for ID ${arxivId}:`, error);
        return null;
    }
}

async function processPublication(workGroup) {
    const work = workGroup['work-summary'] ? workGroup['work-summary'][0] : workGroup;
    const title = work.title?.title?.value || 'Untitled';
    const journalTitle = work['journal-title']?.value || '';
    const publicationDate = work['publication-date'];
    const year = publicationDate?.year?.value?.toString() || '';
    const month = publicationDate?.month?.value?.toString() || '';

    const externalIds = work['external-ids']?.['external-id'] || [];
    const doiObj = externalIds.find((id) => id['external-id-type'] === 'doi');
    const arxivObj = externalIds.find((id) => id['external-id-type'] === 'arxiv');
    const doiValue = doiObj ? doiObj['external-id-value'] : null;
    const arxivValue = arxivObj ? arxivObj['external-id-value'] : null;

    const isArxivDoi = doiValue && (
        doiValue.toLowerCase().includes('arxiv') ||
        doiValue.startsWith('10.48550/')
    );

    let arxivIdToUse = arxivValue;
    if (isArxivDoi && !arxivIdToUse) {
        const match = doiValue.match(/10\.48550\/(?:ARXIV\.?|arXiv\.?)?(.+)/i);
        if (match) arxivIdToUse = match[1];
    }

    let metadataSource = null;
    if (arxivIdToUse || isArxivDoi) {
        metadataSource = await fetchArxivMetadata(arxivIdToUse);
    }
    if (!metadataSource && doiValue && !isArxivDoi) {
        metadataSource = await fetchCrossrefMetadata(doiValue);
    }

    return {
        ...work,
        metadata: metadataSource,
        processedInfo: {
            doi: doiValue,
            arxivId: arxivIdToUse,
            isArxivDoi,
            journalTitle: metadataSource?.['container-title']?.[0] || journalTitle || (arxivIdToUse || isArxivDoi ? 'arXiv Preprint' : ''),
            year,
            month,
            authors: metadataSource?.author || []
        }
    };
}

async function loadExisting() {
    if (!fs.existsSync(OUTPUT_FILE)) return { works: [], generationDate: null };
    try {
        const content = fs.readFileSync(OUTPUT_FILE, 'utf8');
        const dateMatch = content.match(/const generationDate = ['"]([^'"]+)['"]/);
        const generationDate = dateMatch ? dateMatch[1] : null;
        const worksMatch = content.match(/const publications = (\[[\s\S]*?\]);/);
        if (worksMatch) {
            return {
                works: JSON.parse(worksMatch[1]),
                generationDate
            };
        }
    } catch (e) {
        console.log(`⚠️  Error loading existing cache: ${e.message}`);
    }
    return { works: [], generationDate: null };
}

async function generate(forceMode = false) {
    console.log('🚀 Generating Publications Cache with metadata...');
    try {
        const existingData = await loadExisting();
        const lastGeneration = existingData.generationDate;

        const now = new Date();
        const daysSinceLastGen = lastGeneration
            ? (now - new Date(lastGeneration)) / (24 * 60 * 60 * 1000)
            : Infinity;

        let shouldUpdate = false;
        if (forceMode || !lastGeneration || daysSinceLastGen > 30) {
            shouldUpdate = true;
        }

        const freshWorks = await fetchFromORCID();

        // Safety guard: don't wipe a previously valid cache when the API call fails/returns empty.
        if (freshWorks.length === 0 && existingData.works.length > 0) {
            console.log('⚠️ ORCID returned 0 works. Keeping existing publications cache to avoid data loss.');
            return;
        }
        
        if (!shouldUpdate && freshWorks.length <= existingData.works.length) {
            console.log(`📅 Cache is fresh (${Math.round(daysSinceLastGen)} days old) and counts match. Skipping update.`);
            return;
        }

        console.log(`📦 Processing ${freshWorks.length} publications...`);
        const processedWorks = [];
        for (const work of freshWorks) {
            processedWorks.push(await processPublication(work));
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const currentDate = new Date().toISOString();
        const fileContent = `// Auto-generated publications data
// Last updated: ${currentDate}
const generationDate = '${currentDate}';

const publications = ${JSON.stringify(processedWorks, null, 2)};

export { generationDate };
export default publications;
`;
        
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        
        fs.writeFileSync(OUTPUT_FILE, fileContent);
        console.log(`✅ Done! Saved ${processedWorks.length} publications with metadata to ${OUTPUT_FILE}`);
    } catch (e) {
        console.error('❌ Error generating publications cache:', e);
    }
}

const args = process.argv.slice(2);
const forceMode = args.includes('--force') || args.includes('-f');

generate(forceMode);
