// ORCID API Configuration
const ORCID_ID = '0000-0003-0243-9124'; // Replace with your ORCID ID
const USER_NAME = 'Roy'; // Your last name to make it bold in author lists
const MAX_PUBLICATIONS_HOMEPAGE = 2; // Show only 2 on homepage
const IS_HOMEPAGE = window.location.pathname === '/' || window.location.pathname.includes('index');

// Fetch publications from ORCID
async function fetchPublications() {
    const loader = document.getElementById('publications-loader');
    const container = document.getElementById('publications-container');

    if (!loader || !container) return;

    try {
        // Fetch works from ORCID API
        const response = await fetch(`https://pub.orcid.org/v3.0/${ORCID_ID}/works`, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch publications');
        }

        const data = await response.json();
        const works = data.group || [];

        // Sort by publication date (most recent first)
        const sortedWorks = works
            .map((workGroup) => workGroup['work-summary']?.[0])
            .filter((work) => work !== undefined)
            .sort((a, b) => {
                const dateA = a['publication-date'];
                const dateB = b['publication-date'];

                if (!dateA) return 1;
                if (!dateB) return -1;

                const yearA = Number(dateA.year?.value) || 0;
                const yearB = Number(dateB.year?.value) || 0;
                const monthA = Number(dateA.month?.value) || 0;
                const monthB = Number(dateB.month?.value) || 0;

                if (yearB !== yearA) return yearB - yearA;
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

        // Hide loader
        loader.style.display = 'none';

        if (publicationsToShow.length === 0) {
            container.innerHTML = '<p class="no-publications">No publications found.</p>';
            return;
        }

        // Group publications by year
        const groupedPublications = {};
        publicationsToShow.forEach((work) => {
            const year = work['publication-date']?.year?.value?.toString() || 'Unknown';
            if (!groupedPublications[year]) {
                groupedPublications[year] = [];
            }
            groupedPublications[year].push(work);
        });

        // Render grouped publications
        for (const year of Object.keys(groupedPublications).sort((a, b) => Number(b) - Number(a))) {
            // Render Year Heading (Right Column)
            const yearTitle = document.createElement('h3');
            yearTitle.className = 'year-title';
            yearTitle.textContent = year;
            yearTitle.style.gridColumn = "2";
            container.appendChild(yearTitle);

            // Render Items for this year
            for (const work of groupedPublications[year]) {
                const numberDiv = document.createElement('div');
                numberDiv.className = 'publication-number';
                numberDiv.textContent = (work._displayNumber || '') + '.';
                
                const item = await createPublicationItem(work);
                
                container.appendChild(numberDiv);
                container.appendChild(item);
            }
        }

        // Initialize collapse functionality
        initializeCollapseButtons();

    } catch (error) {
        console.error('Error fetching publications:', error);
        loader.style.display = 'none';
        container.innerHTML = '<p class="error-message">Unable to load publications. Please try again later.</p>';
    }
}

// Fetch metadata from Crossref API
async function fetchCrossrefMetadata(doi) {
    if (!doi) return null;

    try {
        const response = await fetch(`https://api.crossref.org/works/${doi}`);
        if (!response.ok) return null;

        const data = await response.json();
        return data.message;
    } catch (error) {
        console.error('Error fetching Crossref metadata:', error);
        return null;
    }
}

// Fetch metadata from arXiv API
async function fetchArxivMetadata(arxivId) {
    if (!arxivId) return null;

    try {
        // Clean the arXiv ID (remove any prefix like "arXiv:")
        const cleanId = arxivId.replace(/^arXiv:/i, '').trim();
        console.log(`Fetching arXiv metadata for ID: ${cleanId}`);

        // arXiv API does not support CORS, so we use a proxy for client-side fetching
        const apiUrl = `https://export.arxiv.org/api/query?id_list=${cleanId}`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`;

        const response = await fetch(proxyUrl);
        if (!response.ok) {
            console.error('arXiv API (via proxy) returned non-OK status:', response.status);
            return null;
        }

        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName('parsererror');
        if (parserError.length > 0) {
            console.error('XML Parsing Error:', parserError[0].textContent);
            return null;
        }

        // Use getElementsByTagNameNS with '*' to ignore namespaces
        const entries = xmlDoc.getElementsByTagNameNS('*', 'entry');
        if (entries.length === 0) {
            console.warn('No <entry> element found in arXiv XML');
            return null;
        }
        const entry = entries[0];

        // Extract title
        const titleEls = entry.getElementsByTagNameNS('*', 'title');
        const title = titleEls.length > 0 ? titleEls[0].textContent?.trim() : '';

        // Extract published date
        const publishedEls = entry.getElementsByTagNameNS('*', 'published');
        const published = publishedEls.length > 0 ? publishedEls[0].textContent?.trim() : '';

        // Extract authors - very robustly
        const authorElements = entry.getElementsByTagNameNS('*', 'author');
        console.log(`Found ${authorElements.length} author elements via getElementsByTagNameNS`);

        const authors = Array.from(authorElements).map(authorEl => {
            // Find name child - ignore namespaces
            const nameEls = authorEl.getElementsByTagNameNS('*', 'name');
            if (nameEls.length === 0) return null;

            const fullName = nameEls[0].textContent.trim();
            if (!fullName) return null;

            // Handle name parts
            const nameParts = fullName.split(/\s+/);
            if (nameParts.length === 1) {
                return { given: '', family: nameParts[0] };
            }
            const family = nameParts[nameParts.length - 1];
            const given = nameParts.slice(0, -1).join(' ');
            return { given, family };
        }).filter(author => author !== null);

        // Extract primary category
        let primaryClass = '';
        const primaryCategoryEls = entry.getElementsByTagNameNS('*', 'primary_category');
        if (primaryCategoryEls.length > 0) {
            primaryClass = primaryCategoryEls[0].getAttribute('term') || '';
        }

        // Extract year from published date
        const year = published ? new Date(published).getFullYear().toString() : '';

        console.log('arXiv metadata successfully extracted:', { title, authorsCount: authors.length, year });

        return {
            type: 'arxiv',
            title,
            author: authors,
            'container-title': ['arXiv Preprint'],
            year,
            publisher: 'arXiv',
            arxivId: cleanId,
            primaryClass: primaryClass
        };
    } catch (error) {
        console.error('Error fetching arXiv metadata:', error);
        return null;
    }
}

// Format authors list with bold for user's name
function formatAuthors(authors) {
    console.log('formatAuthors called with:', authors);

    if (!authors || authors.length === 0) {
        console.log('No authors provided to formatAuthors');
        return '';
    }

    const formattedAuthors = authors.map(author => {
        const given = author.given || '';
        const family = author.family || '';
        const fullName = `${given} ${family}`.trim();

        // Check if this is the user's name and make it bold
        if (family === USER_NAME) {
            return `<strong>${fullName}</strong>`;
        }
        return fullName;
    });

    // If more than 50 authors, show first 50 and add "show full list" option
    if (formattedAuthors.length > 50) {
        const first50 = formattedAuthors.slice(0, 50);
        const remaining = formattedAuthors.slice(50);

        let html = '';

        // Format first 50 authors
        if (first50.length > 1) {
            const lastAuthor = first50.pop();
            html = first50.join(', ') + ', ' + lastAuthor;
        } else {
            html = first50[0];
        }

        // Add remaining authors in a collapsible section
        const uniqueId = 'authors-' + Math.random().toString(36).substr(2, 9);
        let remainingHtml = '';
        if (remaining.length > 1) {
            const lastRemainingAuthor = remaining.pop();
            remainingHtml = ', ' + remaining.join(', ') + ', and ' + lastRemainingAuthor;
        } else {
            remainingHtml = ', and ' + remaining[0];
        }

        html += `<span class="authors-full-list" id="${uniqueId}">${remainingHtml}</span> <button class="show-all-authors-btn" onclick="toggleAuthorsList('${uniqueId}')">... show full author list</button>`;

        return html;
    }

    // Format the author list for 50 or fewer authors
    if (formattedAuthors.length === 1) {
        return formattedAuthors[0];
    } else if (formattedAuthors.length === 2) {
        return formattedAuthors.join(' and ');
    } else {
        const lastAuthor = formattedAuthors.pop();
        return formattedAuthors.join(', ') + ', and ' + lastAuthor;
    }
}

// Create year section with publications
async function createYearSection(year, publications) {
    const section = document.createElement('div');
    section.className = 'year-section';

    const yearTitle = document.createElement('h3');
    yearTitle.className = 'year-title';
    yearTitle.textContent = year;

    const publicationsList = document.createElement('div');
    publicationsList.className = 'publications-year-list';

    for (const work of publications) {
        const publicationItem = await createPublicationItem(work);
        publicationsList.appendChild(publicationItem);
    }

    section.appendChild(yearTitle);
    section.appendChild(publicationsList);

    return section;
}

// Create individual publication item with collapsible bibtex
async function createPublicationItem(work) {
    const item = document.createElement('div');
    item.className = 'publication-item';

    const title = work.title?.title?.value || 'Untitled';
    const journalTitle = work['journal-title']?.value || '';
    const publicationDate = work['publication-date'];
    const year = publicationDate?.year?.value?.toString() || '';
    const month = publicationDate?.month?.value?.toString() || '';

    // Get DOI or other external identifiers
    const externalIds = work['external-ids']?.['external-id'] || [];
    const doiObj = externalIds.find((id) => id['external-id-type'] === 'doi');
    const arxivObj = externalIds.find((id) => id['external-id-type'] === 'arxiv');
    const doiValue = doiObj ? doiObj['external-id-value'] : null;
    const arxivValue = arxivObj ? arxivObj['external-id-value'] : null;

    // Check if DOI is an arXiv DOI (covers various formats)
    const isArxivDoi = doiValue && (
        doiValue.toLowerCase().includes('arxiv') ||
        doiValue.startsWith('10.48550/') ||
        doiValue.match(/10\.48550\/.+/i)
    );

    // Extract arXiv ID from DOI or use existing arXiv value
    let arxivIdToUse = arxivValue;
    if (isArxivDoi && !arxivIdToUse) {
        // Extract arXiv ID from various DOI formats:
        // "10.48550/ARXIV.2411.15221" -> "2411.15221"
        // "10.48550/arXiv.2411.15221" -> "2411.15221"
        const match = doiValue.match(/10\.48550\/(?:ARXIV\.?|arXiv\.?)?(.+)/i);
        if (match) {
            arxivIdToUse = match[1];
        }
    }

    console.log('Identifier extraction:', { doiValue, arxivValue, isArxivDoi, arxivIdToUse });

    // Determine the primary link (prefer DOI over arXiv for non-arXiv DOIs)
    let linkUrl = '#';
    if (doiValue && !isArxivDoi) {
        linkUrl = `https://doi.org/${doiValue}`;
    } else if (arxivIdToUse) {
        const cleanArxivId = arxivIdToUse.replace(/^arXiv:/i, '');
        linkUrl = `https://arxiv.org/abs/${cleanArxivId}`;
    } else if (doiValue) {
        linkUrl = `https://doi.org/${doiValue}`;
    }

    // Fetch metadata - prioritize arXiv API for arXiv papers
    let metadataSource = null;
    if (arxivIdToUse || isArxivDoi) {
        metadataSource = await fetchArxivMetadata(arxivIdToUse);
    }
    if (!metadataSource && doiValue && !isArxivDoi) {
        metadataSource = await fetchCrossrefMetadata(doiValue);
    }

    // Extract metadata
    let authors = [];
    let volume = '';
    let issue = '';
    let pages = '';
    let publisher = '';
    let primaryClass = '';
    let finalJournalTitle = journalTitle;

    if (metadataSource) {
        authors = metadataSource.author || [];
        volume = metadataSource.volume || '';
        issue = metadataSource.issue || '';
        pages = metadataSource.page || '';
        publisher = metadataSource.publisher || '';
        primaryClass = metadataSource.primaryClass || '';
        finalJournalTitle = metadataSource['container-title']?.[0] || journalTitle;
    }

    // Enforce "arXiv Preprint" for arXiv papers if the title is generic or missing
    if ((isArxivDoi || arxivIdToUse) && (!finalJournalTitle || finalJournalTitle.toLowerCase() === 'arxiv')) {
        finalJournalTitle = 'arXiv Preprint';
    }

    console.log('Publication metadata:', { title, authors, metadataSource });

    // Format authors
    const authorsHtml = formatAuthors(authors);

    // Format date
    let dateString = '';
    if (year) {
        dateString = month ? `${getMonthName(month)} ${year}` : year;
    }

    // Generate BibTeX
    const bibtex = generateBibtex({
        title,
        authors: metadataSource?.author || [],
        journalTitle: finalJournalTitle,
        year,
        volume,
        issue,
        pages,
        doi: isArxivDoi ? null : doiValue, // Don't include arXiv DOI in BibTeX
        arxivId: arxivIdToUse,
        publisher,
        primaryClass,
        type: metadataSource?.type
    });

    // Build metadata line parts
    const metaParts = [];
    if (finalJournalTitle) metaParts.push(`<span class="publication-journal">${finalJournalTitle}</span>`);
    if (volume) metaParts.push(`<span class="publication-volume">Vol. ${volume}</span>`);
    if (issue) metaParts.push(`<span class="publication-issue">Issue ${issue}</span>`);
    if (pages) metaParts.push(`<span class="publication-pages">pp. ${pages}</span>`);
    if (arxivIdToUse) {
        const cleanArxivId = arxivIdToUse.replace(/^arXiv:/i, '');
        metaParts.push(`<span class="publication-arxiv">arXiv:${cleanArxivId}</span>`);
    }
    if (dateString) metaParts.push(`<span class="publication-date">${dateString}</span>`);

    const metaLineHtml = metaParts.join('<span class="separator">•</span>');

    console.log('Rendering publication:', { title, authorsHtml, authors });

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
        <button class="copy-bibtex-btn">Copy</button>
      </div>
    </div>
  `;

    return item;
}

// Generate BibTeX citation
function generateBibtex(data) {
    const { title, authors, journalTitle, year, volume, issue, pages, doi, arxivId, publisher, primaryClass, type } = data;

    // Create citation key from first author's last name and year
    let citationKey = 'article' + year;
    if (authors && authors.length > 0) {
        const firstAuthorFamily = authors[0].family || '';
        citationKey = firstAuthorFamily.toLowerCase() + year;
    }

    // Determine entry type - use @misc for arXiv preprints, @article for published papers
    const entryType = (type === 'arxiv' && !doi) ? 'misc' : 'article';

    // Format authors for BibTeX
    let authorString = '';
    if (authors && authors.length > 0) {
        if (entryType === 'misc') {
            // For arXiv papers: "FirstName LastName and FirstName LastName"
            authorString = authors.map(author => {
                const given = author.given || '';
                const family = author.family || '';
                return `${given} ${family}`.trim();
            }).join(' and ');
        } else {
            // For regular papers: "LastName, FirstName and LastName, FirstName"
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

    // Add arXiv-specific fields for @misc entries
    if (entryType === 'misc' && arxivId) {
        const cleanArxivId = arxivId.replace(/^arXiv:/i, '').trim();
        bibtex += `  eprint={${cleanArxivId}},\n`;
        bibtex += `  archivePrefix={arXiv},\n`;
        if (primaryClass) bibtex += `  primaryClass={${primaryClass}},\n`;
        bibtex += `  url={https://arxiv.org/abs/${cleanArxivId}},\n`;
    } else if (arxivId) {
        // For published papers that also have arXiv
        const cleanArxivId = arxivId.replace(/^arXiv:/i, '').trim();
        bibtex += `  archivePrefix={arXiv},\n`;
        bibtex += `  eprint={${cleanArxivId}},\n`;
    }

    if (doi) bibtex += `  doi={${doi}},\n`;
    bibtex += `}`;

    return bibtex;
}

// Toggle authors list visibility
function toggleAuthorsList(id) {
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
}

// Make toggleAuthorsList available globally
window.toggleAuthorsList = toggleAuthorsList;

// Initialize bibtex toggle and copy functionality
function initializeCollapseButtons() {
    // Bibtex toggle buttons
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

        // Copy bibtex button
        if (e.target.closest('.copy-bibtex-btn')) {
            const btn = e.target.closest('.copy-bibtex-btn');
            const bibtexContent = btn.previousElementSibling.textContent;

            navigator.clipboard.writeText(bibtexContent).then(() => {
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                btn.classList.add('copied');

                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
    });
}

// Helper function to get month name
function getMonthName(month) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[parseInt(month) - 1] || '';
}

// Load publications when the page loads
document.addEventListener('DOMContentLoaded', fetchPublications);
