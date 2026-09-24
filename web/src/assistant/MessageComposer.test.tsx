// Tests the composer's dictation wiring in isolation. ../voice/dictation is
// Worker 1's module (not yet landed at the time this suite was written --
// see the HANDOFF) -- it's mocked here so this suite doesn't depend on
// that file existing, and so we can drive onText calls directly the way a
// real speech API would (interim updates repeat the whole utterance so
// far, not a delta).

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Self-contained: the project's vitest.config.ts has no global setupFiles,
// so jest-dom matchers (toBeDisabled/toBeInTheDocument) are extended here
// rather than assumed to be registered globally.
import "@testing-library/jest-dom/vitest";
import MessageComposer from "./MessageComposer";

type OnText = (text: string, isFinal: boolean) => void;

let capturedOnText: OnText | null = null;
let capturedActive = false;

vi.mock("../voice/dictation", () => ({
  useDictation: (options: { onText: OnText; active: boolean }) => {
    capturedOnText = options.onText;
    capturedActive = options.active;
    return { status: "idle", start: vi.fn(), stop: vi.fn() };
  },
}));

function ControlledComposer(props: { onSend?: () => void; sending?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <MessageComposer
      value={value}
      onChange={setValue}
      onSend={props.onSend ?? vi.fn()}
      onCancel={vi.fn()}
      sending={props.sending ?? false}
    />
  );
}

afterEach(() => {
  cleanup();
  capturedOnText = null;
  capturedActive = false;
});
beforeEach(() => {
  capturedOnText = null;
  capturedActive = false;
});

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText("Message") as HTMLTextAreaElement;
}

describe("MessageComposer dictation guard", () => {
  it("replaces the live text on each interim update instead of appending, avoiding duplication", () => {
    render(<ControlledComposer />);
    expect(capturedOnText).not.toBeNull();

    act(() => capturedOnText!("hello", false));
    expect(textarea().value).toBe("hello");

    // A real interim update repeats the whole utterance-so-far -- if the
    // composer just appended blindly this would become "hello hello world".
    act(() => capturedOnText!("hello world", false));
    expect(textarea().value).toBe("hello world");

    act(() => capturedOnText!("hello world", true));
    expect(textarea().value).toBe("hello world");
  });

  it("lands finalized dictated text without auto-sending", () => {
    const onSend = vi.fn();
    render(<ControlledComposer onSend={onSend} />);

    act(() => capturedOnText!("send the lamp to trash", true));

    expect(textarea().value).toBe("send the lamp to trash");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("appends a second utterance after the first, once finalized, without duplicating either", () => {
    render(<ControlledComposer />);

    act(() => capturedOnText!("first part", true));
    expect(textarea().value).toBe("first part");

    act(() => capturedOnText!("second", false));
    expect(textarea().value).toBe("first part second");

    act(() => capturedOnText!("second part", true));
    expect(textarea().value).toBe("first part second part");
  });

  it("does not duplicate text the user typed manually before dictation started", () => {
    render(<ControlledComposer />);

    fireEvent.change(textarea(), { target: { value: "typed prefix" } });
    expect(textarea().value).toBe("typed prefix");

    act(() => capturedOnText!("dictated", false));
    expect(textarea().value).toBe("typed prefix dictated");

    act(() => capturedOnText!("dictated", true));
    expect(textarea().value).toBe("typed prefix dictated");
  });

  it("passes the mic toggle state through as the active flag, opt-in only", () => {
    render(<ControlledComposer />);
    expect(capturedActive).toBe(false);

    fireEvent.click(screen.getByLabelText("Start dictation"));
    expect(capturedActive).toBe(true);

    fireEvent.click(screen.getByLabelText("Stop dictation"));
    expect(capturedActive).toBe(false);
  });
});

describe("MessageComposer send button", () => {
  it("disables send when the draft is empty or the composer is sending", () => {
    const { rerender } = render(<ControlledComposer />);
    expect(screen.getByLabelText("Send message")).toBeDisabled();

    fireEvent.change(textarea(), { target: { value: "hi" } });
    expect(screen.getByLabelText("Send message")).not.toBeDisabled();

    rerender(<ControlledComposer sending />);
    expect(screen.queryByLabelText("Send message")).toBeNull();
    expect(screen.getByLabelText("Stop")).toBeInTheDocument();
  });

  it("submits on Enter but not on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<ControlledComposer onSend={onSend} />);
    fireEvent.change(textarea(), { target: { value: "hello" } });

    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
