import { describe, expect, it } from "vitest";
import { buildRows, guessMapping, parseCsv } from "@/lib/crm/csv";

describe("CRM CSV import parsing", () => {
  it("parses quotes, escaped quotes, CRLF and BOM", () => {
    const rows = parseCsv('﻿name,email\r\n"Doe, Jane","jane@x.io"\r\n"Say ""hi""",b@x.io\n\n');
    expect(rows).toEqual([["name", "email"], ["Doe, Jane", "jane@x.io"], ['Say "hi"', "b@x.io"]]);
  });

  it("sniffs semicolon delimiters", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("maps Luma headers and flags invalid + duplicate emails", () => {
    const [header, ...data] = parseCsv(
      "api_id,name,first_name,last_name,email,phone_number\n" +
        "gst-1,Ada Lovelace,Ada,Lovelace,ADA@x.io,+46 70\n" +
        "gst-2,,Alan,Turing,not-an-email,\n" +
        "gst-3,Ada again,,,ada@x.io,\n",
    );
    const m = guessMapping(header);
    expect(m.email).toBe(4);
    expect(m.external_ref).toBe(0);
    const rows = buildRows(data, m);
    expect(rows[0]).toMatchObject({ email: "ada@x.io", full_name: "Ada Lovelace", phone: "+46 70", external_ref: "gst-1", problems: [] });
    expect(rows[1].full_name).toBe("Alan Turing");
    expect(rows[1].problems).toContain("invalid email");
    expect(rows[2].duplicateOf).toBe(2);
  });
});
