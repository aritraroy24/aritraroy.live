// package import
import rss from '@astrojs/rss';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';

// function import
import { getCollection } from 'astro:content';
import { formatPosts } from '@js/utils'

export async function GET(context) {
    const allVideos = await getCollection("videos");
    const formattedVideos = formatPosts(allVideos);
    return rss({
        xmlns: { atom: "http://www.w3.org/2005/Atom" },
        title: 'Aritra Roy | YouTube Videos',
        description: 'I\'m a Theoretical Computational Materials Scientist & Algorithm Enthusiast from India. If you subscribe to this RSS feed you will receive updates and summaries of my new youtube videos about computational chemistry, materials science, programming and stuff.',
        site: context.site,
        author: "Aritra Roy",
        commentsUrl: "https://github.com/aritraroy24/astro-portfolio-comments/discussions",
        source: {
            title: "Aritra Roy | YouTube Videos RSS Feed",
            url: "https://aritraroy.live/tutorial/videos/rss.xml"
        },
        items: formattedVideos.map((video) => {
            const slugParts = video.slug.split('/');
            const lastPart = slugParts[slugParts.length - 1];
            return {
                title: video.data.title,
                description: video.data.description,
                pubDate: video.data.pubDate,
                link: `/tutorial/videos/${lastPart}`,
                categories: video.data.tags,
                content: `${[sanitizeHtml(marked.parse(video.body)) + sanitizeHtml(marked.parse("Duration: " + video.data.duration))]}`,
            };
        }),
        customData: `<atom:link href="https://aritraroy.live/tutorial/videos/rss.xml" rel="self" type="application/rss+xml" />`,
        stylesheet: '/rss/video-rss-styles.xsl',
    });
}