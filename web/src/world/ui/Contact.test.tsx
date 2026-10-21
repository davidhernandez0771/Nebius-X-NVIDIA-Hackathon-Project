// The quiet Contact entry point, top right: a button that opens a small panel listing the links from one
// config file (site/contact.ts), empty until the team's socials arrive.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CONTACT_LINKS } from "../../site/contact";
import { Contact } from "./Contact";

afterEach(cleanup);

describe("the Contact entry point", () => {
  it("opens a panel that says the links are coming while the list is empty, and closes on Escape", () => {
    expect(CONTACT_LINKS).toEqual([]);
    render(<Contact />);
    const button = screen.getByRole("button", { name: "Contact" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("dialog", { name: "Contact" });
    expect(within(panel).getByText("Links coming soon.")).toBeTruthy();
    // Signed with the mark: the lockup, named SANT.
    expect(within(panel).getByRole("img", { name: "SANT" })).toBeTruthy();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("lists each link, opening in a new tab, and drops anything that isn't http(s) or mailto", () => {
    render(
      <Contact
        links={[
          { label: "GitHub", href: "https://github.com/example" },
          { label: "Email", href: "mailto:team@example.com" },
          { label: "Bad", href: "javascript:alert(1)" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Contact" }));
    const panel = screen.getByRole("dialog", { name: "Contact" });
    const links = within(panel).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["GitHub", "Email"]);
    expect(links[0].getAttribute("href")).toBe("https://github.com/example");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(within(panel).queryByText("Links coming soon.")).toBeNull();
    // The close button closes it too.
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
