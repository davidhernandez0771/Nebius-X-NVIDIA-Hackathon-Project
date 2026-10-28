// The site's contact links, in the order the Contact panel lists them (world/ui/Contact.tsx): the project's public
// repository (every Results citation already links into it), then the team's socials when they arrive, e.g.
// { label: "LinkedIn", href: "https://…" }. Only https://, http:// and mailto: links are shown.
export interface ContactLink {
  label: string;
  href: string;
}

export const CONTACT_LINKS: readonly ContactLink[] = [
  { label: "GitHub · the project's code and notes", href: "https://github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project" },
];
