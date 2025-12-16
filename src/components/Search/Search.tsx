// library import
import { useState, useEffect, useRef } from 'react';
import Fuse from 'fuse.js';
import { FaSearch } from 'react-icons/fa'
import { GoStopwatch } from 'react-icons/go'
import { IoMdCalendar } from 'react-icons/io'

// function import
import { formatDate } from "@js/utils";

// style import
import "./styles/Search.scss"

// type import
// import { getCollection } from "astro:content";
// type CollectionEntry = Awaited<ReturnType<typeof getCollection>>[number];
type CollectionEntry = {
    slug: string;
    data: {
        title: string;
        description: string;
        duration?: string;
        pubDate?: Date;
        [key: string]: any;
    };
};

const options = {
    keys: ['data.title', 'data.description', 'slug'],
    includeMatches: true,
    minMatchCharLength: 1,
    threshold: 0.3,
    ignoreLocation: true,
    shouldSort: true
};
type Props = {
    searchList: CollectionEntry[];
};
function Search({ searchList }: Props) {
    const [query, setQuery] = useState('');
    const fuse = new Fuse(searchList, options);
    const searchContainerRef = useRef<HTMLDivElement>(null);

    const posts = fuse
        .search(query)
        .map((result) => result.item)

    useEffect(() => {
        if (searchContainerRef.current) {
            const height = searchContainerRef.current.scrollHeight;
            const rootHeight = height + 300;
            document.documentElement.style.height = `${rootHeight}px`;
        }
    }, [posts]);

    function handleOnSearch({ target }: { target: HTMLInputElement }) {
        const { value } = target;
        setQuery(value);
    }

    interface Post {
        slug: string;
        title: string;
        description: string;
    }
    interface SectionProps {
        posts: Post[];
        slugKey: string;
        heading: string;
    }

    function Section({ posts, slugKey, heading }: SectionProps) {
        const filteredPosts = posts.filter((post: any) => post.slug.includes(slugKey))

        return (
            <>
                {filteredPosts.length > 0 && (
                    <div>
                        {filteredPosts.length > 1 ? (
                            <h2 className="postHeading">{`${heading}s`}</h2>
                        ) : (<h2 className="postHeading">{heading}</h2>)}
                        <ul>
                            {filteredPosts.map((post: any, index) => (
                                <li key={index} className="postListItem">
                                    <a href={`/${post.slug}`}>
                                        <h4>{post.data.title}</h4>
                                        <p className="info">{heading === "Video" || heading === "Blog" ? (<><GoStopwatch /> {post.data.duration} ~ <IoMdCalendar /> {formatDate(post.data.pubDate)}</>) : (<>Status: {post.data.status}</>)}</p>
                                        <p>{post.data.description}</p>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </>
        )
    }

    return (
        < div className='searchBarContainer' ref={searchContainerRef} >
            <label htmlFor="search" className="custom-field"></label>
            <div className='inputContainer'>
                <div id='searchIcon'>
                    <FaSearch />
                </div>
                <input type="text" value={query} onChange={handleOnSearch} placeholder="Search Any Blog, Video or Project" />
            </div>
            {
                query.length > 2 ? (
                    <>
                        <p className="resultSummary">
                            Found {posts.length} {posts.length === 1 ? 'result' : 'results'} for '{query}'
                        </p>
                        <Section posts={posts} slugKey="projects/research" heading="Research Project" />
                        <Section posts={posts} slugKey="videos" heading="Video" />
                        <Section posts={posts} slugKey="blogs" heading="Blog" /></>
                ) : (<p className="resultSummary">
                    Write at least 3 characters
                </p>)
            }
        </div >
    );
}

export default Search;