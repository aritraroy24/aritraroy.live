# Aritra Roy - Portfolio

[![Astro](https://img.shields.io/badge/Astro-BC52EE?logo=astro&logoColor=fff)](https://astro.build) [![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=000)](https://react.dev) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/) [![Three.js](https://img.shields.io/badge/Three.js-000000?logo=threedotjs&logoColor=fff)](https://threejs.org/) [![Sass](https://img.shields.io/badge/Sass-CC6699?logo=sass&logoColor=fff)](https://sass-lang.com/) [![PHP](https://img.shields.io/badge/PHP-777BB4?logo=php&logoColor=fff)](https://www.php.net/) [![MDX](https://img.shields.io/badge/MDX-fcb839?logo=mdx&logoColor=000)](https://mdxjs.com/)

Personal portfolio website for Aritra Roy - Doctoral Researcher in Digital Chemistry and Materials Science at [SLIMES](https://slimeslab.github.io/) Lab in LSBU, UK under [Dr John Buckeridge](https://jbuckeridge.github.io/).

![Portfolio Screenshot](./screenshot.png)

## Features

- **Animated Fullerene**: Floating molecular background on homepage
- **Research Showcase**: Publications, software projects, and collaborators (3D interactive globe for larger devices)
- **Blog & Tutorials**: Technical articles with syntax highlighting
- **Responsive Design**: Optimized for all devices
- **Performance**: Built with Astro for fast page loads

## Tech Stack

- **Framework**: Astro 5
- **UI**: React 18 + TypeScript
- **Styling**: SCSS
- **3D Visualization**: React Globe GL (collaborators map)
- **Content**: MDX with Expressive Code
- **Data**: Various API integration

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Data Generation

```bash
# Update publications from ORCID
npm run generate-publications

# Update collaborators data
npm run generate-collaborators

# Update both (runs before build)
npm run prebuild
```

## Project Structure

```
├── src/
│   ├── assets/          # Images, styles, data
│   ├── components/      # React & Astro components
│   ├── layouts/         # Page layouts
│   ├── pages/          # Routes
│   └── content/        # Blog posts & tutorials
├── public/             # Static assets
└── scripts/            # Data generation scripts
```

## Copyright

© 2025 Aritra Roy | All rights reserved.

---

Built with ❤️ using [Astro](https://astro.build).
