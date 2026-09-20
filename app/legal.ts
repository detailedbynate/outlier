/**
 * Shared facts the legal pages state out loud.
 *
 * They live here so the three pages can't drift apart: one effective date, one
 * jurisdiction, one minimum age. Bump the date whenever the wording changes in
 * a way that affects what someone agreed to.
 */

export const EFFECTIVE_DATE = "September 20, 2026";

/** Where disputes are heard. Change this if the operator's province changes. */
export const JURISDICTION = "Ontario, Canada";

/** Minimum age to hold an account. Deliberately above COPPA's 13. */
export const MIN_AGE = 16;

export const CONTACT_EMAIL = "support@useoutlier.online";
