import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mode « autonome » : utile UNIQUEMENT pour faire tourner l'application
  // en local sur un ordinateur (mode hors ligne, node .next/standalone/server.js).
  // Sur Vercel, ce mode doit rester désactivé : il entre en conflit avec leur
  // chaîne de déploiement (erreur « ENOENT .next/next-server.js.nft.json »).
  // Vercel définit automatiquement la variable VERCEL pendant ses builds.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  reactStrictMode: true,
  // Garde-fou réactivé : le build échoue en cas d'erreur de type TypeScript.
  // (Auparavant ignoreBuildErrors: true laissait passer des bugs réels.)
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
