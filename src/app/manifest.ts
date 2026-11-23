import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Life OS",
    short_name: "Life OS",
    description: "Your private workspace",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f1114",
    theme_color: "#0f1114",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
