"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/icons";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#daily-picks", label: "Daily picks" },
  { href: "#faq", label: "FAQ" },
];

/** Floating pill header that tightens and gains contrast once the page scrolls. */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`pill-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="pill-header-inner">
        <Link href="/" className="pill-brand" aria-label="Outlier home">
          <BrandMark size={30} />
          <span>Outlier</span>
        </Link>
        <nav className="pill-nav" aria-label="Sections">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="pill-actions">
          <Link href="/login" className="pill-signin">
            Sign in
          </Link>
          <a href="#waitlist" className="pill-cta">
            Join waitlist
          </a>
        </div>
      </div>
    </header>
  );
}
