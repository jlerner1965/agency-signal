const aliases = {
  agencyName: ["business_name", "company_name", "company", "business", "name", "agency_name", "agency"],
  website: ["website", "url", "domain", "site"],
  contactName: ["contact_name", "contact", "contact_person", "owner_name"],
  firstName: ["first_name", "firstname", "first"],
  lastName: ["last_name", "lastname", "last"],
  carrier: ["industry", "category", "vertical", "carrier", "business_type"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  email: ["email", "email_address", "contact_email"],
  phone: ["phone", "phone_number", "telephone"],
  notes: ["notes", "note", "description"],
};

function normalizeHeader(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n") { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function valueFor(record, keys) {
  for (const key of keys) if (record[key]) return record[key].trim();
  return "";
}

export function parseLeadCsv(text) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const directContact = valueFor(record, aliases.contactName);
    const contactName = directContact || [valueFor(record, aliases.firstName), valueFor(record, aliases.lastName)].filter(Boolean).join(" ");
    return {
      agencyName: valueFor(record, aliases.agencyName),
      website: valueFor(record, aliases.website),
      contactName,
      carrier: valueFor(record, aliases.carrier) || "Uncategorized",
      city: valueFor(record, aliases.city),
      state: valueFor(record, aliases.state),
      email: valueFor(record, aliases.email),
      phone: valueFor(record, aliases.phone),
      notes: valueFor(record, aliases.notes),
    };
  }).filter((row) => row.agencyName || row.website || row.email);
}
