declare module "react-reveal/Fade";
declare module "astro-headless-ui";
declare module "astro:content";
declare module "astro:assets";
declare module 'astro-icon/components' {
    export const Icon: any;
}
declare module "*.scss" {
    const content: { [className: string]: string };
    export default content;
}