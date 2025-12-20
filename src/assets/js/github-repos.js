// GitHub API Configuration
const GITHUB_USERNAME = 'aritraroy24';
const GITHUB_API_URL = `https://api.github.com/users/${GITHUB_USERNAME}/repos`;

// Fetch GitHub repositories
async function fetchGitHubRepos() {
    const loader = document.getElementById('repos-loader');
    const container = document.getElementById('repos-container');

    if (!loader || !container) return;

    try {
        const response = await fetch(GITHUB_API_URL);

        if (!response.ok) {
            throw new Error('Failed to fetch GitHub repositories');
        }

        const repos = await response.json();

        // Filter repositories that have "research" in their topics
        const researchRepos = repos.filter(repo =>
            repo.topics && repo.topics.includes('research')
        );

        // Sort by updated date (most recent first)
        const sortedRepos = researchRepos.sort((a, b) =>
            new Date(b.updated_at) - new Date(a.updated_at)
        );

        // Hide loader
        loader.style.display = 'none';

        if (sortedRepos.length === 0) {
            container.innerHTML = '<p class="no-repos">No research repositories found.</p>';
            return;
        }

        // Render repository cards
        sortedRepos.forEach(repo => {
            const repoCard = createRepoCard(repo);
            container.appendChild(repoCard);
        });

    } catch (error) {
        console.error('Error fetching GitHub repositories:', error);
        loader.style.display = 'none';
        container.innerHTML = '<p class="error-message">Unable to load repositories. Please try again later.</p>';
    }
}

// Create repository card
function createRepoCard(repo) {
    const card = document.createElement('div');
    card.className = 'repo-card';

    const name = repo.name || 'Unnamed Repository';
    const description = repo.description || 'No description available';
    const language = repo.language || 'N/A';
    const stars = repo.stargazers_count || 0;
    const forks = repo.forks_count || 0;
    const repoUrl = repo.html_url || '#';
    const homepage = repo.homepage || null;

    // Get language color (common programming languages)
    const languageColor = getLanguageColor(language);

    card.innerHTML = `
        <div class="repo-card-content">
            <div class="repo-header">
                <h3 class="repo-name">
                    <a href="${repoUrl}" target="_blank" rel="noopener noreferrer">
                        ${name}
                    </a>
                </h3>
                ${homepage ? `<a href="${homepage}" class="repo-homepage" target="_blank" rel="noopener noreferrer" title="View Documentation">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                </a>` : ''}
            </div>
            <p class="repo-description">${description}</p>
            <div class="repo-meta">
                ${language !== 'N/A' ? `
                    <span class="repo-language">
                        <span class="language-dot" style="background-color: ${languageColor};"></span>
                        ${language}
                    </span>
                ` : ''}
                <span class="repo-stars">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
                    </svg>
                    ${stars}
                </span>
                <span class="repo-forks">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
                    </svg>
                    ${forks}
                </span>
            </div>
        </div>
    `;

    return card;
}

// Get language color for common programming languages
function getLanguageColor(language) {
    const colors = {
        'JavaScript': '#f1e05a',
        'TypeScript': '#2b7489',
        'Python': '#3572A5',
        'Java': '#b07219',
        'C++': '#f34b7d',
        'C': '#555555',
        'C#': '#178600',
        'PHP': '#4F5D95',
        'Ruby': '#701516',
        'Go': '#00ADD8',
        'Rust': '#dea584',
        'Swift': '#ffac45',
        'Kotlin': '#F18E33',
        'R': '#198CE7',
        'Shell': '#89e051',
        'HTML': '#e34c26',
        'CSS': '#563d7c',
        'Vue': '#41b883',
        'Jupyter Notebook': '#DA5B0B',
        'SCSS': '#c6538c',
        'Dart': '#00B4AB'
    };

    return colors[language] || '#8b949e';
}

// Load repositories when the page loads
document.addEventListener('DOMContentLoaded', fetchGitHubRepos);
