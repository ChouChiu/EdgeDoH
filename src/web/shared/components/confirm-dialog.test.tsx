// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { ConfirmDialog } from "./confirm-dialog";

beforeEach(() => localStorage.setItem("locale", "en-US"));
afterEach(cleanup);

async function open(onConfirm: () => void) {
  render(
    <I18nProvider>
      <ConfirmDialog title="Delete phone?" description="Its DoH URL stops working" confirmLabel="Delete" onConfirm={onConfirm}>
        <button type="button">Remove</button>
      </ConfirmDialog>
    </I18nProvider>,
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  return screen.findByRole("alertdialog");
}

describe("ConfirmDialog", () => {
  it("shows the title and description before anything runs", async () => {
    const onConfirm = vi.fn();
    const dialog = await open(onConfirm);
    expect(within(dialog).getByText("Delete phone?")).toBeTruthy();
    expect(within(dialog).getByText("Its DoH URL stops working")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("runs the action only on confirm", async () => {
    const onConfirm = vi.fn();
    fireEvent.click(within(await open(onConfirm)).getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    cleanup();

    fireEvent.click(within(await open(onConfirm)).getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
