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

/**
 * Minimum age to hold an account: COPPA's floor, and the same age YouTube
 * itself requires. Both legal pages qualify it out loud, because a flat number
 * would be wrong in two ways — GDPR lets member states set digital consent
 * anywhere up to 16, and someone this age can't agree to a paid subscription
 * on their own.
 */
export const MIN_AGE = 13;

export const CONTACT_EMAIL = "support@useoutlier.online";
