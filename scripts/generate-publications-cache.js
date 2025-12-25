// Node.js script to pre-generate publications data from ORCID
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const ORCID_ID = '0000-0003-0243-9124';
const DATA_DIR = path.join(__dirname, '../src/assets/js/data');
const OUTPUT_FILE = path.join(DATA_DIR, 'publications-cache.js');

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

async function loadExisting() {
    if (!fs.existsSync(OUTPUT_FILE)) return { works: [], generationDate: null };
    try {
        const content = fs.readFileSync(OUTPUT_FILE, 'utf8');

        // Extract generation date
        const dateMatch = content.match(/const generationDate = ['"]([^'"]+)['"]/);
        const generationDate = dateMatch ? dateMatch[1] : null;

        // Extract works array
        const worksMatch = content.match(/const publications = ([\s\S]*?);/);
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
    console.log('🚀 Generating Publications Cache...');
    try {
        const existingData = await loadExisting();
        const lastGeneration = existingData.generationDate;

        // Check if we should update
        const now = new Date();
        const daysSinceLastGen = lastGeneration
            ? (now - new Date(lastGeneration)) / (24 * 60 * 60 * 1000)
            : Infinity;

        let shouldUpdate = false;
        if (forceMode || !lastGeneration || daysSinceLastGen > 30) {
            shouldUpdate = true;
        }

        const freshWorks = await fetchFromORCID();
        
        if (!shouldUpdate && freshWorks.length <= existingData.works.length) {
            console.log(`📅 Cache is fresh (${Math.round(daysSinceLastGen)} days old) and counts match. Skipping update.`);
            return;
        }

        if (freshWorks.length < existingData.works.length && !forceMode) {
            console.log(`⚠️  Fresh data has fewer publications than cache (${freshWorks.length} < ${existingData.works.length}). Skipping update to avoid data loss unless forced.`);
            return;
        }

        const currentDate = new Date().toISOString();
        const fileContent = `// Auto-generated publications data
// Last updated: ${currentDate}
const generationDate = '${currentDate}';

const publications = ${JSON.stringify(freshWorks, null, 2)};

export { generationDate };
export default publications;
`;
        
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        
        fs.writeFileSync(OUTPUT_FILE, fileContent);
        console.log(`✅ Done! Saved ${freshWorks.length} publications to ${OUTPUT_FILE}`);
        console.log(`📅 Generation date: ${currentDate}`);
    } catch (e) {
        console.error('❌ Error generating publications cache:', e);
    }
}

// Check command line arguments
const args = process.argv.slice(2);
const forceMode = args.includes('--force') || args.includes('-f');

generate(forceMode);