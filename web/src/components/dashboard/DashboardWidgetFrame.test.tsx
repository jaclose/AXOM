// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardWidgetFrame } from "./DashboardWidgetFrame";

afterEach(cleanup);

function renderFrame(onSave = vi.fn()) {
  render(
    <DashboardWidgetFrame
      widgetId="focus"
      title="Focus timer"
      size="medium"
      fields={[
        { id: "intention", label: "Intention", checked: true },
        { id: "history", label: "Recent sessions", checked: false },
      ]}
      onSave={onSave}
    >
      <div>Timer content</div>
    </DashboardWidgetFrame>,
  );
  return onSave;
}

describe("DashboardWidgetFrame", () => {
  it("provides a stable size contract and exposes only one side at a time", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DashboardWidgetFrame widgetId="focus" title="Focus timer" size="extra-large" onSave={vi.fn()}>
        <div>Timer content</div>
      </DashboardWidgetFrame>,
    );
    const frame = container.querySelector(".dashboard-widget-frame")!;
    expect(frame.classList.contains("dashboard-widget-frame--extra-large")).toBe(true);
    expect(frame.getAttribute("data-widget-size")).toBe("extra-large");
    expect(screen.getByText("Timer content")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Customize Focus timer" })).toBeNull();

    const trigger = screen.getByRole("button", { name: "Customize Focus timer" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBeTruthy();
    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Timer content").closest(".dashboard-widget-frame__front")?.hasAttribute("hidden")).toBe(true);
    expect(screen.getByRole("region", { name: "Customize Focus timer" })).toBeTruthy();
    expect(document.querySelectorAll(".dashboard-widget-frame__front:not([hidden]), .dashboard-widget-frame__settings:not([hidden])")).toHaveLength(1);
  });

  it("moves focus into settings, traps Tab, and Escape discards before restoring focus", async () => {
    const user = userEvent.setup();
    const onSave = renderFrame();
    const trigger = screen.getByRole("button", { name: "Customize Focus timer" });
    await user.click(trigger);
    const panel = screen.getByRole("region", { name: "Customize Focus timer" });
    const close = within(panel).getByRole("button", { name: "Close Focus timer settings" });
    const small = within(panel).getByRole("radio", { name: /Small/ });
    const save = within(panel).getByRole("button", { name: "Save changes" });

    expect(document.activeElement).toBe(close);
    expect(save.hasAttribute("disabled")).toBe(true);
    await user.click(small);
    expect(save.hasAttribute("disabled")).toBe(false);
    save.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Customize Focus timer" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onSave).not.toHaveBeenCalled();

    await user.click(trigger);
    expect((screen.getByRole("radio", { name: /Medium/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("saves size and field changes together and Cancel never leaks drafts", async () => {
    const user = userEvent.setup();
    const onSave = renderFrame();
    const trigger = screen.getByRole("button", { name: "Customize Focus timer" });
    await user.click(trigger);
    await user.click(screen.getByRole("radio", { name: /Large/ }));
    await user.click(screen.getByRole("checkbox", { name: "Recent sessions" }));
    expect(screen.getByRole("status").textContent).toBe("Changes ready to save");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      size: "large",
      fields: { intention: true, history: true },
    });
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(screen.getByRole("radio", { name: /Small/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("offers a visible top exit without persisting unchanged settings", async () => {
    const user = userEvent.setup();
    const onSave = renderFrame();
    await user.click(screen.getByRole("button", { name: "Customize Focus timer" }));
    expect(screen.getByRole("status").textContent).toBe("No changes yet");
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Close Focus timer settings" }));
    expect(screen.queryByRole("region", { name: "Customize Focus timer" })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
});
