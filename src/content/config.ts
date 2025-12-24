// 1. Import utilities from `astro:content`
import { z, defineCollection } from "astro:content";

// 2. Define your collection(s)
const blogCollection = defineCollection({
  schema: (ctx: { image: () => any }) =>
    z.object({
      isDraft: z.boolean(),
      title: z.string(),
      subtitle: z.string(),
      description: z.string(),
      duration: z.string(),
      cover: ctx.image(),
      tags: z.array(z.string()),
      pubDate: z.date(),
      type: z.string()
    }),
});
const videoCollection = defineCollection({
  schema: (ctx: { image: () => any }) =>
    z.object({
      title: z.string(),
      videoId: z.string(),
      description: z.string(),
      duration: z.string(),
      cover: ctx.image(),
      tags: z.array(z.string()),
      pubDate: z.date(),
      type: z.string()
    }),
});
export const collections = {
  'blogs': blogCollection,
  'videos': videoCollection,
};
