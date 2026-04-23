import { defineCollection, z } from "astro:content";

const entryBase = z.object({
  date: z.coerce.date(),
  body: z.string().default(""),
  author: z.string().optional(),
  audio: z.string().optional(),
  image: z.string().optional(),
  source: z.enum(["web", "sms", "voice", "email"]).default("web"),
});

export const collections = {
  posts: defineCollection({ type: "data", schema: entryBase }),
  messages: defineCollection({
    type: "data",
    schema: entryBase.extend({
      from: z.string().optional(),
    }),
  }),
};
