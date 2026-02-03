import publicationsStatic, { generationDate } from './data/publications-cache.js';

// Configuration
const USER_NAME = 'Aritra Roy';
const MAX_PUBLICATIONS_HOMEPAGE = 2;
const IS_HOMEPAGE = window.location.pathname === '/' || window.location.pathname.includes('index');

// Cache configuration
const CACHE_KEY = 'publications_cache_v2'; // New version since schema changed
const CACHE_TIMESTAMP_KEY = 'publications_cache_timestamp_v2';

// Get publications (preferring localStorage, falling back to static)
function getPublications() {
    try {
        const localCached = localStorage.getItem(CACHE_KEY);
        const localTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);

        // If we have local data and it's not older than our static data, use it
        if (localCached && localTimestamp) {
            const localDate = new Date(localTimestamp);
            const staticDate = new Date(generationDate);

            if (localDate >= staticDate) {
                console.log('✓ Loaded publications from localStorage');
                return JSON.parse(localCached);
            }
        }

        // Otherwise use static data and save it to localStorage for next time
        console.log('✓ Loaded publications from static cache');
        saveToCache(publicationsStatic);
        return publicationsStatic;
    } catch (error) {
        console.error('Error reading cache:', error);
        return publicationsStatic || [];
    }
}

// Save publications to localStorage cache
function saveToCache(works) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(works));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, generationDate || new Date().toISOString());
        console.log(`✓ Cached ${works.length} publications to localStorage`);
    } catch (error) {
        console.warn('Error saving to cache (likely quota exceeded):', error);
    }
}

// Main function to display publications
function displayPublications() {
    const loader = document.getElementById('publications-loader');
    const container = document.getElementById('publications-container');

    if (!loader || !container) return;

    try {
        const works = getPublications();

        // Convert works to work summaries format if needed (already processed in script)
        const sortedWorks = works
            .sort((a, b) => {
                const dateA = a.processedInfo.year;
                const dateB = b.processedInfo.year;
                const monthA = Number(a.processedInfo.month) || 0;
                const monthB = Number(b.processedInfo.month) || 0;

                if (dateB !== dateA) return Number(dateB) - Number(dateA);
                return monthB - monthA;
            });

        // Limit publications for homepage
        const publicationsToShow = IS_HOMEPAGE
            ? sortedWorks.slice(0, MAX_PUBLICATIONS_HOMEPAGE)
            : sortedWorks;

        // Assign display numbers (Highest for newest)
        const totalCount = publicationsToShow.length;
        publicationsToShow.forEach((work, index) => {
            work._displayNumber = totalCount - index;
        });

        if (publicationsToShow.length === 0) {
            loader.style.display = 'none';
            container.innerHTML = '<p class="no-publications">No publications found.</p>';
            return;
        }

        // Process all publications (now synchronous)
        const processedPublications = publicationsToShow.map((work) => {
            const item = createPublicationItem(work);
            return {
                year: work.processedInfo.year || 'Unknown',
                displayNumber: work._displayNumber,
                item: item
            };
        });

        // Group processed publications by year
        const groupedPublications = {};
        processedPublications.forEach((pub) => {
            if (!groupedPublications[pub.year]) {
                groupedPublications[pub.year] = [];
            }
            groupedPublications[pub.year].push(pub);
        });

        const fragment = document.createDocumentFragment();
        const sortedYears = Object.keys(groupedPublications).sort((a, b) => Number(b) - Number(a));

        // Render grouped publications to fragment
        for (const year of sortedYears) {
            const yearTitle = document.createElement('h2');
            yearTitle.className = 'year-title';
            yearTitle.textContent = year;
            yearTitle.style.gridColumn = "2";
            fragment.appendChild(yearTitle);

            for (const pub of groupedPublications[year]) {
                const numberDiv = document.createElement('div');
                numberDiv.className = 'publication-number';
                numberDiv.textContent = (pub.displayNumber || '') + '.';

                fragment.appendChild(numberDiv);
                fragment.appendChild(pub.item);
            }
        }

        // Hide loader and render all at once
        loader.style.display = 'none';
        container.innerHTML = '';
        container.appendChild(fragment);

        // Initialize collapse functionality
        initializeCollapseButtons();

    } catch (error) {
        console.error('Error displaying publications:', error);
        loader.style.display = 'none';
        container.innerHTML = '<p class="error-message">Unable to load publications. Please try again later.</p>';
    }
}

// Format authors list with highlight for user's name
function formatAuthors(authors) {
    if (!authors || authors.length === 0) return '';

    const formattedAuthors = authors.map(author => {
        const given = author.given || '';
        const family = author.family || '';
        const fullName = `${given} ${family}`.trim();

        if (fullName === USER_NAME) {
            return `<span style="color: #64ffda;">${fullName}</span>`;
        }
        return fullName;
    });

    if (formattedAuthors.length > 50) {
        const first50 = formattedAuthors.slice(0, 50);
        const remaining = formattedAuthors.slice(50);
        let html = first50.join(', ') + ', ' + first50.pop();

        const uniqueId = 'authors-' + Math.random().toString(36).substr(2, 9);
        let remainingHtml = ', ' + remaining.join(', ') + ', and ' + remaining.pop();

        html += `<span class="authors-full-list" id="${uniqueId}">${remainingHtml}</span> <button class="show-all-authors-btn" onclick="toggleAuthorsList('${uniqueId}')">... show full author list</button>`;
        return html;
    }

    if (formattedAuthors.length === 1) return formattedAuthors[0];
    if (formattedAuthors.length === 2) return formattedAuthors.join(' and ');
    
    const lastAuthor = formattedAuthors.pop();
    return formattedAuthors.join(', ') + ', and ' + lastAuthor;
}

// Create individual publication item
function createPublicationItem(work) {
    const item = document.createElement('div');
    item.className = 'publication-item';

    const info = work.processedInfo;
    const title = work.title?.title?.value || 'Untitled';
    
    let linkUrl = '#';
    if (info.doi && !info.isArxivDoi) {
        linkUrl = `https://doi.org/${info.doi}`;
    } else if (info.arxivId) {
        const cleanArxivId = info.arxivId.replace(/^arXiv:/i, '');
        linkUrl = `https://arxiv.org/abs/${cleanArxivId}`;
    } else if (info.doi) {
        linkUrl = `https://doi.org/${info.doi}`;
    }

    const authorsHtml = formatAuthors(info.authors);
    let dateString = info.year;
    if (info.month) dateString = `${getMonthName(info.month)} ${info.year}`;

    const bibtex = generateBibtex({
        title,
        authors: info.authors,
        journalTitle: info.journalTitle,
        year: info.year,
        volume: work.metadata?.volume,
        issue: work.metadata?.issue,
        pages: work.metadata?.page,
        doi: info.isArxivDoi ? null : info.doi,
        arxivId: info.arxivId,
        publisher: work.metadata?.publisher,
        primaryClass: work.metadata?.primaryClass,
        type: work.metadata?.type
    });

    const metaParts = [];
    if (info.journalTitle) metaParts.push(`<span class="publication-journal">${info.journalTitle}</span>`);
    if (work.metadata?.volume) metaParts.push(`<span class="publication-volume">Vol. ${work.metadata.volume}</span>`);
    if (work.metadata?.issue) metaParts.push(`<span class="publication-issue">Issue ${work.metadata.issue}</span>`);
    if (work.metadata?.page) metaParts.push(`<span class="publication-pages">pp. ${work.metadata.page}</span>`);
    if (info.arxivId) {
        const cleanArxivId = info.arxivId.replace(/^arXiv:/i, '');
        metaParts.push(`<span class="publication-arxiv">arXiv:${cleanArxivId}</span>`);
    }
    if (dateString) metaParts.push(`<span class="publication-date">${dateString}</span>`);

    const metaLineHtml = metaParts.join('<span class="separator">•</span>');

    item.innerHTML = `
    <div class="publication-content">
      <div class="publication-title-line">
        <a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="publication-link">
          ${title}
        </a>
      </div>
      ${authorsHtml ? `<div class="publication-authors">${authorsHtml}</div>` : ''}
      <div class="publication-meta-line">
        ${metaLineHtml}
      </div>
      <div class="publication-actions">
        <button class="link-btn" onclick="window.open('${linkUrl}', '_blank')">link</button>
        <button class="bibtex-toggle-btn" data-expanded="false">
          bibtex <span class="bibtex-arrow">▼</span>
        </button>
      </div>
      <div class="bibtex-container" style="display: none;">
        <pre class="bibtex-content">${bibtex}</pre>
        <button class="copy-bibtex-btn">BibTeX</button>
      </div>
    </div>
  `;

    return item;
}

// Generate BibTeX citation
function generateBibtex(data) {
    const { title, authors, journalTitle, year, volume, issue, pages, doi, arxivId, publisher, primaryClass, type } = data;

    let citationKey = 'article' + year;
    if (authors && authors.length > 0) {
        const firstAuthorFamily = authors[0].family || '';
        citationKey = firstAuthorFamily.toLowerCase() + year;
    }

    const entryType = (type === 'arxiv' && !doi) ? 'misc' : 'article';

    let authorString = '';
    if (authors && authors.length > 0) {
        if (entryType === 'misc') {
            authorString = authors.map(author => {
                const given = author.given || '';
                const family = author.family || '';
                return `${given} ${family}`.trim();
            }).join(' and ');
        } else {
            authorString = authors.map(author => {
                const given = author.given || '';
                const family = author.family || '';
                return `${family}, ${given}`.trim();
            }).join(' and ');
        }
    }

    let bibtex = `@${entryType}{${citationKey},\n`;
    bibtex += `  title={${title}},\n`;
    if (authorString) bibtex += `  author={${authorString}},\n`;

    if (entryType === 'article' && journalTitle && journalTitle !== 'arXiv preprint') {
        if (journalTitle) bibtex += `  journal={${journalTitle}},\n`;
        if (volume) bibtex += `  volume={${volume}},\n`;
        if (issue) bibtex += `  number={${issue}},\n`;
        if (pages) bibtex += `  pages={${pages}},\n`;
    }

    if (year) bibtex += `  year={${year}},\n`;

    if (entryType === 'misc' && arxivId) {
        const cleanArxivId = arxivId.replace(/^arXiv:/i, '').trim();
        bibtex += `  eprint={${cleanArxivId}},\n`;
        bibtex += `  archivePrefix={arXiv},\n`;
        if (primaryClass) bibtex += `  primaryClass={${primaryClass}},\n`;
        bibtex += `  url={https://arxiv.org/abs/${cleanArxivId}},\n`;
    } else if (arxivId) {
        const cleanArxivId = arxivId.replace(/^arXiv:/i, '').trim();
        bibtex += `  archivePrefix={arXiv},\n`;
        bibtex += `  eprint={${cleanArxivId}},\n`;
    }

    if (doi) bibtex += `  doi={${doi}},\n`;
    bibtex += `}`;

    return bibtex;
}

// Toggle authors list visibility
window.toggleAuthorsList = function(id) {
    const authorsList = document.getElementById(id);
    const button = event.target;
    if (authorsList) {
        if (authorsList.classList.contains('visible')) {
            authorsList.classList.remove('visible');
            button.textContent = '... show full author list';
        } else {
            authorsList.classList.add('visible');
            button.textContent = '... hide full author list';
        }
    }
};

// Initialize bibtex toggle and copy functionality
function initializeCollapseButtons() {
    document.addEventListener('click', function (e) {
        if (e.target.closest('.bibtex-toggle-btn')) {
            const btn = e.target.closest('.bibtex-toggle-btn');
            const publicationItem = btn.closest('.publication-item');
            const bibtexContainer = publicationItem.querySelector('.bibtex-container');
            const arrow = btn.querySelector('.bibtex-arrow');
            const isExpanded = btn.getAttribute('data-expanded') === 'true';

            if (isExpanded) {
                bibtexContainer.style.display = 'none';
                btn.setAttribute('data-expanded', 'false');
                arrow.textContent = '▼';
            } else {
                bibtexContainer.style.display = 'block';
                btn.setAttribute('data-expanded', 'true');
                arrow.textContent = '▲';
            }
        }

        if (e.target.closest('.copy-bibtex-btn')) {
            const btn = e.target.closest('.copy-bibtex-btn');
            const bibtexContent = btn.previousElementSibling.textContent;

            navigator.clipboard.writeText(bibtexContent).then(() => {
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                btn.blur();
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
    });
}

function getMonthName(month) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[parseInt(month) - 1] || '';
}

// Load publications when the page loads
document.addEventListener('DOMContentLoaded', displayPublications);
