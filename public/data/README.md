# Collaborators Data

This directory is for documentation only. The actual collaborators cache file is located at:

**`public/collaborators-cache.json`** (at the root of the public folder)

This location avoids conflicts with Astro's dynamic routing system.

## How it Works

The system uses **automatic cache generation + browser localStorage** for optimal performance:

### **Build Time** (Automatic):
1. **`npm run build`** automatically runs `prebuild` script
2. Fetches all collaborators from OpenAlex/ORCID
3. Geocodes all institutions via Nominatim (OpenStreetMap)
4. Generates `collaborators-cache.json` with complete profiles
5. File committed to repo and deployed

### **Production** (Browser):
1. Page loads → Reads `collaborators-cache.json` (instant, from CDN)
2. Checks for new collaborators from APIs
3. If new collaborators found:
   - Geocodes only NEW institutions
   - Saves updated cache to browser localStorage
4. If no new collaborators → Instant display (no API calls!)

### **Subsequent Visits**:
- Uses merged static cache + localStorage
- Only fetches if new publications detected
- Near-instant loading

## File Structure

### **collaborators-cache.json**
Auto-generated during build, contains complete collaborator profiles:

```json
{
  "version": "1.0",
  "lastUpdated": "2025-12-22T10:30:00.000Z",
  "generatedAt": "build",
  "collaborators": [
    {
      "id": "https://openalex.org/A1234567890",
      "name": "John Doe",
      "affiliation": "University of Oxford",
      "country": "GB",
      "orcid": "https://orcid.org/0000-0000-0000-0000",
      "collaborations": 5,
      "dois": [
        {
          "doi": "https://doi.org/10.1234/example",
          "title": "Paper Title"
        }
      ],
      "institutionId": "https://openalex.org/I1234567",
      "latitude": 51.7548,
      "longitude": -1.2544,
      "city": "Oxford"
    }
  ]
}
```

## Scripts

### **Manual Generation** (Optional):
```bash
npm run generate-collaborators
```

### **Automatic Build** (Runs automatically):
```bash
npm run build
# Runs: prebuild → generate-collaborators → astro build
```

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                      BUILD TIME                          │
│  npm run build → generate-collaborators-cache.js        │
│  ✓ Fetches all collaborators                            │
│  ✓ Geocodes all institutions (1 req/sec)                │
│  ✓ Generates public/collaborators-cache.json            │
│  ✓ Commits to repo                                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   FIRST USER VISIT                       │
│  Page loads → Reads collaborators-cache.json (CDN)      │
│  ✓ Displays all cached collaborators instantly          │
│  ✓ No API calls needed                                  │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                  IF NEW PUBLICATIONS                     │
│  Checks OpenAlex → Finds new collaborator               │
│  ✓ Geocodes only NEW institution                        │
│  ✓ Saves to browser localStorage                        │
│  ✓ Displays updated list                                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                 NEXT BUILD (Future)                      │
│  npm run build → Re-generates cache with ALL data       │
│  ✓ Includes previously new collaborators                │
│  ✓ All users get updated static cache                   │
└─────────────────────────────────────────────────────────┘
```

## Benefits

✅ **Zero manual work** - Completely automatic
✅ **Fast builds** - Cache generated before deployment
✅ **Instant page loads** - Static file from CDN
✅ **Auto-updates** - New collaborators geocoded on-the-fly
✅ **No API limits** - Only geocodes new institutions
✅ **Offline ready** - Works after first visit (localStorage)
✅ **Free** - Nominatim API, no keys needed
✅ **Version controlled** - Track collaborator changes over time

## Technical Details

### **Build Script** (`scripts/generate-collaborators-cache.js`):
- Node.js script (ES modules)
- Fetches from OpenAlex + ORCID APIs
- Geocodes via Nominatim (respects 1 req/sec limit)
- Writes JSON to `public/data/`

### **Browser Script** (`src/assets/js/collaborators.js`):
- Loads static cache + localStorage
- Compares with live API data
- Only geocodes new institutions
- Updates localStorage automatically

### **Rate Limiting**:
- Nominatim: 1 request/second (automatically enforced)
- OpenAlex: No limits
- ORCID: No limits

## Console Output Examples

### **Build Time**:
```
🚀 Starting collaborators cache generation...
Fetched 45 works from OpenAlex
Fetched 32 valid DOIs from ORCID

Found 18 unique collaborators

📍 Starting geocoding...
Geocoding 15 unique institutions...

  Geocoding: University of Oxford...
  ✓ University of Oxford -> Oxford (51.7548, -1.2544)
  ...

✓ 15 collaborators have location coordinates

✅ Successfully saved 18 collaborators to:
   /public/collaborators-cache.json

📊 Cache Statistics:
   - Total collaborators: 18
   - With locations: 15
   - Total publications: 45
```

### **Browser (Cached)**:
```
📁 Loaded 18 collaborators from static cache
   Generated at: build, Last updated: 12/22/2025
✓ Initialized cache with 18 total collaborators

🔍 Checking for new collaborators...
Fetched 45 works from OpenAlex
✓ No new collaborators found (all in cache)

📊 Total collaborators: 18
📍 15 collaborators have location coordinates
```

### **Browser (New Collaborator)**:
```
📁 Loaded 18 collaborators from static cache
✓ Initialized cache with 18 total collaborators

🔍 Checking for new collaborators...
Fetched 47 works from OpenAlex

🆕 Found 1 NEW collaborators!
   Geocoding their institutions...

  🌍 Geocoding NEW institution: MIT...
  ✓ MIT -> Cambridge (42.3601, -71.0942)

📊 Total collaborators: 19
💾 Updated cache with 1 new collaborators
📍 16 collaborators have location coordinates
```

## Maintenance

The cache **automatically updates** on each build. No manual intervention needed!

If you want to manually refresh the cache:
```bash
npm run generate-collaborators
git add public/collaborators-cache.json
git commit -m "Update collaborators cache"
```

Then rebuild and deploy.
