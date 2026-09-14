"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/icons";
import { ScrollLink } from "./scroll-link";

const LINKS = [
  { id: "features", label: "Features" },
  { id: "daily-picks", label: "Daily picks" },
  { id: "analyze", label: "Analyzer" },
  { id: "faq", label: "FAQ" },
];

/** Floating glass header. Gains a little contrast on scroll and highlights the section in view. */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const sections = LINKS.map((link) => document.getElementById(link.id)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      // A band across the middle of the screen decides which section is "current".
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5] },
    );
    sections.forEach((section) => observer.observe(section));
    const hero = document.getElementById("waitlist");
    const heroObserver = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setActive(null);
    });
    if (hero) heroObserver.observe(hero);

    return () => {
      window.removeEventListener("scroll", onScroll);
      observer.disconnect();
      heroObserver.disconnect();
    };
  }, []);

  return (
    <header className={`pill-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="pill-header-inner">
        <span className="pill-glass" aria-hidden="true" />
        <Link href="/" className="pill-brand" aria-label="Outlier home" onClick={(e) => {
          if (window.location.pathname === "/") {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}>
          <span className="pill-brand-mark">
            <BrandMark size={30} />
          </span>
          <span>Outlier</span>
        </Link>
        <nav className="pill-nav" aria-label="Sections">
          {LINKS.map((link) => (
            <ScrollLink key={link.id} to={link.id} className="pill-nav-link" ariaCurrent={active === link.id}>
              {link.label}
            </ScrollLink>
          ))}
        </nav>
        <div className="pill-actions">
          <Link href="/login" className="pill-button pill-button-ghost">
            Sign in
          </Link>
          <ScrollLink to="waitlist" className="pill-button pill-button-primary">
            Join waitlist
          </ScrollLink>
        </div>
      </div>
    </header>
  );
}
