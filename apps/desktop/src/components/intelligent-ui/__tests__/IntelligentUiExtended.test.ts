import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstFailedRule } from "../context";
import { iuiIcon } from "../icons";
import { withUnit } from "../units";
import { buttonNamed, mountBlock } from "./fixtures/mountBlock";

describe("extended components", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps a Form from sending until its rules pass", async () => {
    const send = vi.fn();
    const wrapper = await mountBlock(
      `root = Form([Input($name, "Name", null, "text", {required: true}), Input($email, "Email", null, "text", {email: true}), Button("Send", @ToAssistant("Here you go"))])
$name = ""
$email = "nope"`,
      send,
    );
    await flushPromises();

    await buttonNamed(wrapper, "Send").trigger("click");
    await flushPromises();
    expect(send).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Required");
    expect(wrapper.text()).toContain("Enter a valid email address");

    const [name, email] = wrapper.findAll("input");
    await name?.setValue("Ada");
    await email?.setValue("ada@example.com");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Required");

    await buttonNamed(wrapper, "Send").trigger("click");
    expect(send).toHaveBeenCalledWith(
      "Here you go\n\n(name: Ada; email: ada@example.com)",
    );
  });

  it("aligns number columns right and draws component cells", async () => {
    const wrapper = await mountBlock(
      `root = Table(["Name", "Count", "Status"], [["A", 3, Badge("Ok")], ["B", 12, Badge("Late")]])`,
    );
    await flushPromises();

    const heads = wrapper.findAll("th");
    expect(heads[1]?.classes()).toContain("text-right");
    expect(heads[0]?.classes()).not.toContain("text-right");
    expect(wrapper.findAll('td [data-iui="badge"]')).toHaveLength(2);
  });

  it("picks object options by value and shows their labels", async () => {
    const send = vi.fn();
    const wrapper = await mountBlock(
      `root = Stack([RadioGroup($plan, [{value: "free", label: "Free plan", description: "No cost"}, {value: "pro", label: "Pro plan"}], "Plan", "cards"), Button("Go", @ToAssistant("Pick"))])
$plan = "free"`,
      send,
    );
    await flushPromises();

    expect(wrapper.text()).toContain("Free plan");
    expect(wrapper.text()).toContain("No cost");
    await wrapper.findAll('[role="radio"]')[1]?.trigger("click");
    await flushPromises();
    await buttonNamed(wrapper, "Go").trigger("click");
    expect(send).toHaveBeenCalledWith("Pick\n\n(plan: pro)");
  });
});

describe("helpers", () => {
  it("names icons the way models write them", () => {
    expect(iuiIcon("map-pin")).toBeDefined();
    expect(iuiIcon("MapPin")).toBe(iuiIcon("map-pin"));
    expect(iuiIcon("home")).toBe(iuiIcon("house"));
    expect(iuiIcon("no-such-icon")).toBeUndefined();
  });

  it("puts units where readers expect them", () => {
    expect(withUnit(40, "$")).toBe("$40");
    expect(withUnit(25, "%")).toBe("25%");
    expect(withUnit(3.5, "kg")).toBe("3.5 kg");
    expect(withUnit(7, undefined)).toBe("7");
  });

  it("finds the rule a value breaks, as vue-lang validates", () => {
    expect(firstFailedRule("", { required: true })).toEqual({
      type: "required",
      arg: "",
    });
    expect(firstFailedRule("ab", { minLength: 3 })).toEqual({
      type: "minLength",
      arg: "3",
    });
    expect(firstFailedRule(12, { min: 1, max: 10 })).toEqual({
      type: "max",
      arg: "10",
    });
    expect(firstFailedRule("ok", { required: true })).toBeUndefined();
  });
});
