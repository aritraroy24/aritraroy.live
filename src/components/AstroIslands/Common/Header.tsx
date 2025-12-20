// library import
import React, { useState, useEffect } from 'react';
import { Fade } from "react-awesome-reveal";
import { Link } from 'react-scroll';
import Headroom from 'react-headroom';
import { FaSearch } from 'react-icons/fa'

// style import
import './styles/Header.scss';

// asset import
// import NavLogo from '@images/NavLogo.webp'
import NavLogo from '@images/NavLogo.webp'

interface NavbarProps {
    isHomePage?: boolean;
}

const Header: React.FC<NavbarProps> = ({ isHomePage }) => {
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
                        <nav className={isHomePage ? 'homeNavContainer' : 'otherNavContainer'}>
                            <div
                                className={`hamburger-menu ${isActive &&
                                    'hamburger-menu-active'}`}
                                onClick={() => handleIsActive(!isActive)}>
                                <div className='bar-1'></div>
                                <div className='bar-2'></div>
                                <div className='bar-3'></div>
                            </div>
                            <div className='logo'>
                                {isHomePage ? (
                                    <div
                                        onClick={() =>
                                            window.scrollTo({
                                                top: 0,
                                                behavior: 'smooth'
                                            })
                                        }
                                    >
                                        <img src={NavLogo.src} alt="NavLogo" className='homeNavLogo' />
                                    </div>
                                ) : (
                                    <a href="/">
                                        <img src={NavLogo.src} alt="NavLogo" className='otherNavLogo' />
                                    </a>
                                )}
                            </div>
                            <Fade direction='down' cascade delay={300} triggerOnce>
                                <ul
                                    className={`navigation-ul ${isActive &&
                                        'navigation-ul-active'}`}>
                                    <li onClick={() => handleIsActive(false)}>
                                        {isHomePage ? (
                                            <Link
                                                href='/#about'
                                                activeClass='active-scroll'
                                                to='AboutMe'
                                                spy={true}
                                                smooth={true}
                                                ignoreCancelEvents={true}
                                                duration={1200}>
                                                <span>01.</span>About
                                            </Link>
                                        ) : (
                                            <a href="/#about">
                                                <span>01.</span>About
                                            </a>
                                        )}
                                    </li>
                                    <li onClick={() => handleIsActive(false)} className='projects-menu' >
                                        {isHomePage ? (
                                            <Link
                                                href='/#publications'
                                                to='Publications'
                                                spy={true}
                                                smooth={true}
                                                ignoreCancelEvents={true}
                                                duration={1200}>
                                                <span>02.</span>Publications
                                            </Link>
                                        ) : (
                                            <a href="/publications">
                                                <span>02.</span>Publications
                                            </a>
                                        )}
                                    </li>
                                    <li onClick={() => handleIsActive(false)}>
                                        {isHomePage ? (
                                            <Link
                                                href='/#portfolio'
                                                to='Portfolio'
                                                spy={true}
                                                smooth={true}
                                                ignoreCancelEvents={true}
                                                duration={1200}>
                                                <span>03.</span>Portfolio
                                            </Link>
                                        ) : (
                                            <a href="/#portfolio">
                                                <span>03.</span>Portfolio
                                            </a>
                                        )}
                                    </li>
                                    <li onClick={() => handleIsActive(false)} className='projects-menu'>
                                        {isHomePage ? (
                                            <Link
                                                href='/#tutorial'
                                                to='Tutorials'
                                                spy={true}
                                                smooth={true}
                                                ignoreCancelEvents={true}
                                                duration={1200}>
                                                <span>04.</span>Tutorial
                                            </Link>
                                        ) : (
                                            <a href="/tutorial">
                                                <span>04.</span>Tutorial
                                            </a>
                                        )}
                                    </li>
                                    <li onClick={() => handleIsActive(false)}>
                                        {isHomePage ? (
                                            <Link
                                                href='/#contact'
                                                to='Contact'
                                                spy={true}
                                                smooth={true}
                                                ignoreCancelEvents={true}
                                                duration={1200}>
                                                <span>05.</span>Contact
                                            </Link>
                                        ) : (
                                            <a href="/#contact">
                                                <span>05.</span>Contact
                                            </a>
                                        )}
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
