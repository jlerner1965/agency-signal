import test from "node:test";
import assert from "node:assert/strict";
import { parseLeadCsv, parseCsvRows } from "../lib/csv-leads.js";

test("parses quoted CSV fields and escaped quotes", () => {
  assert.deepEqual(parseCsvRows('name,notes\n"Acme, Inc.","Said ""hello"""'), [["name", "notes"], ["Acme, Inc.", 'Said "hello"']]);
});

test("maps common business lead headers", () => {
  const [lead] = parseLeadCsv("Company,Domain,First Name,Last Name,Industry,City,State,Email\nAcme,acme.com,Ada,Lovelace,Plumbing,Denver,CO,ada@acme.com");
  assert.equal(lead.agencyName, "Acme");
  assert.equal(lead.website, "acme.com");
  assert.equal(lead.contactName, "Ada Lovelace");
  assert.equal(lead.carrier, "Plumbing");
});
