// The site's contact links, in the order the Contact panel lists them (world/ui/Contact.tsx). Empty for
// now: the team's socials go here, e.g. { label: "GitHub", href: "https://github.com/…" }. Only
// https://, http:// and mailto: links are shown.
export interface ContactLink {
  label: string;
  href: string;
}

export const CONTACT_LINKS: readonly ContactLink[] = [];
