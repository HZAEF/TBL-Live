import type { NextConfig } from "next";

// ---- En-têtes de sécurité HTTP (v2.4.0) ----
// Appliqués à toutes les réponses, y compris sur Vercel.
//  - X-Content-Type-Options: nosniff → le navigateur ne devine plus le
//    type d'un fichier (anti-« polymalyse » de scripts déguisés).
//  - X-Frame-Options: DENY + frame-ancestors 'none' → l'application ne
//    peut pas être insérée dans l'iframe d'un autre site (anti-clickjacking).
//  - Referrer-Policy → n'envoie pas l'URL complète vers les sites tiers.
//  - Permissions-Policy → caméra/micro/localisation verrouillés.
//  - Content-Security-Policy → seule origine autorisée : la nôtre. Les
//    polices Geist sont auto-hébergées par next/font (pas de CDN tiers).
//    'unsafe-inline' reste nécessaire : Next.js injecte des scripts et des
//    styles inline (hydratation). En développement seulement, React a aussi
//    besoin de 'unsafe-eval' (rechargement à chaud).
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${
        process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"
      }`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

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
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
