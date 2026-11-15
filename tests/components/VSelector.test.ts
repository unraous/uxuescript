import type { SelectorMethods } from "@/components/base/VSelector/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import VSelector from "@/components/base/VSelector.vue";

enableAutoUnmount(afterEach);

function createSelector() {
  const wrapper = mount(VSelector, {
    props: {
      data: {
        label: "Provider",
        selectedIndex: 0,
        mutable: true,
        items: [
          { label: "Default", mutable: false },
          { label: "Custom", mutable: true },
        ],
      },
      methods: {
        select: vi.fn<NonNullable<SelectorMethods["select"]>>(),
        create: vi.fn<NonNullable<SelectorMethods["create"]>>(),
        edit: vi.fn<NonNullable<SelectorMethods["edit"]>>(),
        remove: vi.fn<NonNullable<SelectorMethods["remove"]>>(),
      },
    },
  });
  return wrapper;
}

describe("VSelector", () => {
  it("selects an option from the opened dropdown", async () => {
    const wrapper = createSelector();
    const methods = wrapper.props("methods");

    await wrapper.get(".select-trigger").trigger("click");
    await wrapper.get("button.option-label:nth-child(1)").trigger("click");

    expect(methods.select).toHaveBeenCalledWith(0);
  });

  it("rejects an empty draft and passes a valid draft to the create method", async () => {
    const wrapper = createSelector();
    const methods = wrapper.props("methods");

    await wrapper.get(".select-trigger").trigger("click");
    await wrapper.get('button[aria-label="New"]').trigger("click");
    await wrapper.get("input").setValue("   ");
    await wrapper.get('button[aria-label="Save"]').trigger("click");
    expect(methods.create).not.toHaveBeenCalled();

    await wrapper.get("input").setValue("  Added provider  ");
    await wrapper.get('button[aria-label="Save"]').trigger("click");

    expect(methods.create).toHaveBeenCalledWith("  Added provider  ");
  });
});
