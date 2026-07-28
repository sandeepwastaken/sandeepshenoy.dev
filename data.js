/* ============================================================
   data.js — THE ONE FILE YOU EDIT TO CHANGE CONTENT.
   Every page reads from window.SITE below. Add / remove / reorder
   items in these lists and the pages rebuild themselves.
   ============================================================ */
window.SITE = {

  profile: {
    name: "Sandeep Shenoy",
    email: "sandeepshenoy09@gmail.com",
    tagline: ["Art.", "Code.", "Craft."],
    intro: "I'm Sandeep Shenoy, a developer and artist who thrives where clean code meets bold, expressive visual design."
  },

  sections: [
    { key: "projects", title: "Projects", blurb: "Websites, games & products I've built.", href: "/projects/" },
    { key: "gallery",  title: "Gallery",  blurb: "A hall for my personal favorite art pieces.",        href: "/gallery/"  },
    { key: "theater",  title: "Theater",  blurb: "Watch my creations come to life.",     href: "/theater/"  },
    { key: "toolkit",  title: "Toolkit",  blurb: "Free tools I made and actually use.",     href: "/toolkit/"  }
  ],

  projects: [
    {
      title: "Particle Life",
      blurb: "Dot-based simulation",
      role: "HTML + CSS + JS",
      href: "/projects/particles",
      thumb: "/images/thumbnails/particle.png",
      accent: "#6d5cff",
      date: "2026-07-25",
      tags: ["Emergence", "Simulation"]
    },
    {
      title: "Rouse SciOly Site",
      blurb: "Team-tailored site",
      role: "HTML + CSS + JS",
      href: "https://rousescioly.github.io/",
      thumb: "/images/thumbnails/scioly.png",
      accent: "#2b6cff",
      date: "2025-12-25",
      tags: ["UI/UX Design", "Modern"]
    },
    {
      title: "Cud",
      blurb: "Transformer model built within the restrictions of block-coding",
      role: "Scratch",
      href: "https://scratch.mit.edu/projects/1362191743/",
      thumb: "/images/thumbnails/cud.png",
      accent: "#e7b53a",
      date: "2026-06-05",
      tags: ["Limitations", "Block Coding"]
    },
    {
      title: "Vestige",
      blurb: "Never miss another gaming moment",
      role: "Swift",
      href: "https://github.com/sandeepwastaken/vestige",
      thumb: "/images/thumbnails/vestige.png",
      accent: "#12303a",
      date: "2026-07-24",
      tags: ["Gaming", "Clipping"]
    },
    {
      title: "Generative Series",
      blurb: "Code-driven art",
      role: "Personal · WebGL",
      href: "/gallery/",
      thumb: "",
      accent: "#12303a",
      date: "2024-08-24",
      tags: ["Creative", "WebGL"]
    },
    {
      title: "Generative Series",
      blurb: "Code-driven art",
      role: "Personal · WebGL",
      href: "/gallery/",
      thumb: "",
      accent: "#12303a",
      date: "2024-08-24",
      tags: ["Creative", "WebGL"]
    },
    {
      title: "Generative Series",
      blurb: "Code-driven art",
      role: "Personal · WebGL",
      href: "/gallery/",
      thumb: "",
      accent: "#12303a",
      date: "2024-08-24",
      tags: ["Creative", "WebGL"]
    },
  ],

  gallery: [
    { title: "Mr. Parrot",  src: "/art/parrot.png",  year: "2026", medium: "Colored Pencils" },
    { title: "Hopeful",  src: "/art/hopeful.webp",  year: "2023", medium: "Adobe Illustrator" },
    { title: "Colorful Mandala",  src: "/art/mandala.webp",  year: "2024", medium: "Colored Pencils, Pen" },
    { title: "Emerald Beetle",  src: "/art/beetle.webp",  year: "2025", medium: "Cardboard, Markers, Pen, Paper" },
    { title: "Art Portfolio",  src: "/art/portfolio.webp",  year: "2024", medium: "Colored Pencils, Pen, Markers" },
    { title: "Riptide Shirt Design",  src: "/art/riptideshirt.png",  year: "2026", medium: "Adobe Photoshop" }
  ],

  theater: [
    { youtube: "https://www.youtube.com/watch?v=314htZNimxM", title: "The Backrooms - Recreation", year: "2026", blurb: "" },
    { youtube: "https://www.youtube.com/watch?v=yo4cjBPYL4U", title: "The Backrooms - Beetroot", year: "2026", blurb: "" }
  ],

  tools: [
    { title: "PDF Snipper",   desc: "Pull individual pages out of a PDF.",       href: "#", icon: "✂",  tag: "PDF",   soon: true },
    { title: "Image Convert", desc: "PNG · JPG · WebP, right in the browser.",    href: "#", icon: "⇄",  tag: "Image", soon: true },
    { title: "Color Grab",    desc: "Sample any colour, copy the hex.",           href: "#", icon: "◍",  tag: "Design",soon: true },
    { title: "Word Count",    desc: "Live characters, words & reading time.",     href: "#", icon: "𝍦",  tag: "Text",  soon: true }
  ]
};
