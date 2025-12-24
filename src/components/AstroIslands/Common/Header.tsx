// library import
import React, { useState, useEffect } from 'react';
import { Fade } from "react-awesome-reveal";
import Headroom from 'react-headroom';
import { FaSearch } from 'react-icons/fa'

// style import
import './styles/Header.scss';

// asset import
import NavLogo from '@images/NavLogo.webp'

const Header: React.FC = () => {
    const [isActive, handleIsActive] = useState(false);
    useEffect(() => {
        const preloader = document.getElementById('preloader');
        if (preloader) {
            preloader.remove();
        }
        const delayedContent = document.getElementById('root');
        if (delayedContent) {
            delayedContent.style.display = 'grid';
        }
    }, []);

    return (
        <>
            <div
                className={`blur-hide ${isActive && 'blur-show'}`}
                onClick={() => handleIsActive(false)}></div>
            <div className={`nav-wrapper-mobile`}></div>
            <div className='nav-wrapper'>
                <Headroom disableInlineStyles>
                    <Fade triggerOnce>
                        <nav className='navContainer'>
                            <div
                                className={`hamburger-menu ${isActive &&
                                    'hamburger-menu-active'}`}
                                onClick={() => handleIsActive(!isActive)}>
                                <div className='bar-1'></div>
                                <div className='bar-2'></div>
                                <div className='bar-3'></div>
                            </div>
                            <div className='logo'>
                                <a href="/">
                                    <img src={NavLogo.src} alt="NavLogo" className='navLogo' />
                                </a>
                            </div>
                            <Fade direction='down' cascade delay={300} triggerOnce>
                                <ul
                                    className={`navigation-ul ${isActive &&
                                        'navigation-ul-active'}`}>
                                    <li onClick={() => handleIsActive(false)}>
                                        <a href="/about">About</a>
                                    </li>
                                    <li onClick={() => handleIsActive(false)} className='projects-menu'>
                                        <a href="/research">Research</a>
                                    </li>
                                    <li onClick={() => handleIsActive(false)}>
                                        <a href="/portfolio">Portfolio</a>
                                    </li>
                                    <li onClick={() => handleIsActive(false)} className='projects-menu'>
                                        <a href="/tutorial">Tutorials</a>
                                    </li>
                                    <li onClick={() => handleIsActive(false)}>
                                        <a href="/contact">Contact</a>
                                    </li>
                                    <li>
                                        <a href='/search' title='Search Posts'>
                                            <FaSearch id='searchIcon' title="Search Posts" />
                                        </a>
                                    </li>
                                </ul>
                            </Fade>
                        </nav>
                    </Fade>
                </Headroom>
            </div>
        </>
    );
};

export default Header;
