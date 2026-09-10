import { describe, expect, it } from "vitest";

import {
  deduplicateMemberRows,
  identifyMemberReport,
  parseMemberReport,
  type ParsedMemberRow,
  type ParsedMemberReport,
} from "./member-pdf-import.js";

const englishTitles = {
  total: "TOTAL MEMBERS IN DATABASE (1)",
  active: "ACTIVE MEMBERS IN DATABASE (1)",
  withNumber: "MEMBERS WITH MEMBER NUMBER IN DATABASE (1)",
  noNumber: "MEMBERS WITHOUT MEMBER NUMBER IN DATABASE (1)",
  inactive: "INACTIVE MEMBERS IN DATABASE (1)",
  regularized: "REGULARIZED MEMBERS IN DATABASE (1)",
  activeRegularized: "ACTIVE REGULARIZED MEMBERS IN DATABASE (1)",
  suspended: "SUSPENDED MEMBERS IN DATABASE (1)",
} as const;

const portugueseTitles = {
  total: "TOTAL DE ATLETAS NA BASE DE DADOS (1)",
  active: "ATLETAS ATIVOS NA BASE DE DADOS (1)",
  withNumber: "ATLETAS COM NÚMERO DE SÓCIO NA BASE DE DADOS (1)",
  noNumber: "ATLETAS SEM NÚMERO DE SÓCIO NA BASE DE DADOS (1)",
  inactive: "ATLETAS INATIVOS NA BASE DE DADOS (1)",
  regularized: "ATLETAS COM PAGAMENTOS REGULARIZADOS NA BASE DE DADOS (1)",
  activeRegularized: "ATLETAS ATIVOS COM PAGAMENTOS REGULARIZADOS NA BASE DE DADOS (1)",
  suspended: "ATLETAS SUSPENSOS NA BASE DE DADOS (1)",
} as const;

const englishHeader = "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº";
const portugueseHeader =
  "Número de Sócio | Nome | ID Card Nº | Data de nascimento | Número de contribuinte | Telemóvel";

const inactiveEnglishHeader = `${englishHeader} | Data inativo`;

function headerFor(report: keyof typeof englishTitles, language: "english" | "portuguese"): string {
  const header = language === "english" ? englishHeader : portugueseHeader;
  return report === "inactive" ? `${header} | Data inativo` : header;
}

function reportFixture(
  title: string,
  rows: readonly string[],
  options: Readonly<{ header?: string; inactive?: boolean; repeatedPage?: boolean }> = {},
): string {
  const header = options.header ?? englishHeader;
  const columns =
    options.inactive && !header.endsWith("Data inativo") ? `${header} | Data inativo` : header;
  const footer = "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1";
  return [
    title,
    columns,
    ...rows,
    footer,
    ...(options.repeatedPage ? [columns, ...rows, footer] : []),
  ].join("\n");
}

describe("member PDF import parser", () => {
  it("identifies all eight report keys from English and Portuguese titles", () => {
    for (const report of Object.keys(englishTitles) as Array<keyof typeof englishTitles>) {
      expect(identifyMemberReport(englishTitles[report])).toBe(report);
      expect(identifyMemberReport(portugueseTitles[report])).toBe(report);
    }
  });

  it("accepts the shortened titles and English columns used by the exported reports", () => {
    const exportedTitles = [
      ["ACTIVE MEMBERS (1)", "active"],
      ["ATLETAS ATIVOS REGULARIZADOS (1)", "activeRegularized"],
      ["ATLETAS ATIVOS COM NÚMERO DE SÓCIO (1)", "withNumber"],
      ["INACTIVE MEMBERS (1)", "inactive"],
      ["ATLETAS ATIVOS SEM NÚMERO DE SÓCIO (1)", "noNumber"],
      ["ATLETAS REGULARIZADOS (1)", "regularized"],
      ["SUSPENSOS (1)", "suspended"],
      ["TOTAL DE ATLETAS NA BASE DE DADOS (1)", "total"],
    ] as const;

    for (const [title, report] of exportedTitles) {
      const inactive = report === "inactive";
      const row = inactive
        ? "M-TEST | Layout Member | ID-TEST | 01 Jan 2000 | VAT-TEST | +4470000000 | 02 Feb 2020"
        : "M-TEST | Layout Member | ID-TEST | 01 Jan 2000 | VAT-TEST | +4470000000";
      const parsed = parseMemberReport(
        reportFixture(title, [row], {
          header: inactive ? inactiveEnglishHeader : englishHeader,
          inactive,
        }),
      );
      expect(parsed.report).toBe(report);
    }
  });

  it("parses synthetic rows, repeated page furniture, empty fields, and HTML phone entities", () => {
    const text = [
      "TOTAL MEMBERS IN DATABASE (2)",
      headerFor("total", "english"),
      "M-001 | Synthetic Member One | ID-001 | 01 Jan 2000 | VAT-001 | &#43;44&nbsp;7000&#x2F;1001",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/2",
      headerFor("total", "english"),
      " | Synthetic Member Two |  | 02 Feb 2001 |  | ",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 2/2",
    ].join("\n");

    const parsed = parseMemberReport(text);

    expect(parsed.report).toBe("total");
    expect(parsed.declaredCount).toBe(2);
    expect(parsed.rows).toEqual([
      {
        sourceReport: "total",
        sourceRowNumber: 1,
        membershipNumber: "M-001",
        fullName: "Synthetic Member One",
        idCardNumber: "ID-001",
        birthDate: "2000-01-01",
        vatNumber: "VAT-001",
        mobileNumber: "+44 7000/1001",
      },
      {
        sourceReport: "total",
        sourceRowNumber: 2,
        fullName: "Synthetic Member Two",
        birthDate: "2001-02-02",
      },
    ]);
    expect(parsed.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("joins a row fragment that continues after a page break", () => {
    const text = [
      "TOTAL DE ATLETAS NA BASE DE DADOS (1)",
      portugueseHeader,
      "M-003 | Synthetic Member",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/2",
      portugueseHeader,
      "ID-003 | 03 Mar 2003 | VAT-003 | +4470003003",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 2/2",
    ].join("\n");

    expect(parseMemberReport(text).rows).toEqual([
      {
        sourceReport: "total",
        sourceRowNumber: 1,
        membershipNumber: "M-003",
        fullName: "Synthetic Member",
        idCardNumber: "ID-003",
        birthDate: "2003-03-03",
        vatNumber: "VAT-003",
        mobileNumber: "+4470003003",
      },
    ]);
  });

  it("rejects a continued row that contains more columns than the approved layout", () => {
    const text = [
      "TOTAL MEMBERS IN DATABASE (1)",
      englishHeader,
      "M-003 | Synthetic Member",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/2",
      englishHeader,
      " | ID-003 | 03 Mar 2003 | VAT-003 | +4470003003 | unexpected",
      "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 2/2",
    ].join("\n");

    expect(() => parseMemberReport(text)).toThrow(/continued|column/i);
  });

  it("parses inactive date and derives report status and payment signals", () => {
    const inactive = parseMemberReport(
      reportFixture(
        "INACTIVE MEMBERS IN DATABASE (1)",
        [
          "M-004 | Synthetic Member Four | ID-004 | 04 Apr 2004 | VAT-004 | +4470004004 | 05 May 2025",
        ],
        { inactive: true },
      ),
    );
    const regularized = parseMemberReport(
      reportFixture("ACTIVE REGULARIZED MEMBERS IN DATABASE (1)", [
        "M-005 | Synthetic Member Five |  | 05 May 2005 |  | +4470005005",
      ]),
    );
    const suspended = parseMemberReport(
      reportFixture("SUSPENDED MEMBERS IN DATABASE (1)", [
        "M-006 | Synthetic Member Six |  | 06 Jun 2006 |  | +4470006006",
      ]),
    );

    expect(inactive.rows[0]).toMatchObject({
      inactiveAt: "2025-05-05",
      membershipStatus: "inactive",
    });
    expect(regularized.rows[0]).toMatchObject({
      membershipStatus: "active",
      paymentStatus: "regularized",
    });
    expect(suspended.rows[0]).toMatchObject({ membershipStatus: "suspended" });
  });

  it("omits status fields when the report has no status or payment signal", () => {
    for (const report of ["total", "withNumber", "noNumber", "regularized"] as const) {
      const parsed = parseMemberReport(
        reportFixture(
          englishTitles[report],
          [`M-${report} | Synthetic ${report} Member |  | 01 Jan 2000 |  | +440000000`],
          { header: headerFor(report, "english") },
        ),
      );

      expect(parsed.rows[0]).not.toHaveProperty("membershipStatus");
      if (report === "regularized")
        expect(parsed.rows[0]).toMatchObject({ paymentStatus: "regularized" });
      else expect(parsed.rows[0]).not.toHaveProperty("paymentStatus");
    }
  });

  it("parses every report key and validates declared counts", () => {
    for (const [report, title] of Object.entries(englishTitles)) {
      const parsed = parseMemberReport(
        reportFixture(
          title,
          [
            `M-${report} | Synthetic ${report} Member |  | 01 Jan 2000 |  | +440000000${report === "inactive" ? " | 02 Feb 2020" : ""}`,
          ],
          { header: headerFor(report as keyof typeof englishTitles, "english") },
        ),
      );
      expect(parsed.report).toBe(report);
      expect(parsed.rows).toHaveLength(1);
    }

    expect(() =>
      parseMemberReport(
        reportFixture("TOTAL MEMBERS IN DATABASE (2)", [
          "M-007 | Synthetic Member Seven |  | 07 Jul 2007 |  | +4470007007",
        ]),
      ),
    ).toThrow(/declared count/i);
  });

  it("rejects malformed dates, unknown titles, incompatible headers, and missing footers", () => {
    expect(() =>
      parseMemberReport(
        reportFixture("TOTAL MEMBERS IN DATABASE (1)", [
          "M-008 | Synthetic Member Eight |  | 31 Feb 2008 |  | +4470008008",
        ]),
      ),
    ).toThrow(/date/i);
    expect(() => identifyMemberReport("UNSUPPORTED MEMBERS EXPORT (1)")).toThrow(
      /unsupported|unknown/i,
    );
    expect(() =>
      parseMemberReport(
        [
          "TOTAL MEMBERS IN DATABASE (1)",
          "Member Nº | Name | Unexpected | Birthdate | VAT Number | Mobile nº",
          "M-009 | Synthetic Member Nine |  | 09 Sep 2009 |  | +4470009009",
          "Document produced by www.regyfit.com on 11-08-2026 at 10:30 Page 1/1",
        ].join("\n"),
      ),
    ).toThrow(/header|column/i);
    expect(() =>
      parseMemberReport(
        [
          "TOTAL MEMBERS IN DATABASE (1)",
          englishHeader,
          "M-010 | Synthetic Member Ten |  | 10 Oct 2010 |  | +4470010010",
        ].join("\n"),
      ),
    ).toThrow(/footer/i);
  });

  it("requires the title language and inactive column to match the approved layout", () => {
    expect(() =>
      parseMemberReport(
        reportFixture(
          "TOTAL MEMBERS IN DATABASE (1)",
          ["M-013 | Synthetic Member Thirteen |  | 13 Mar 2013 |  | +4470013013"],
          { header: portugueseHeader },
        ),
      ),
    ).toThrow(/language|header|compatible/i);
    expect(() =>
      parseMemberReport(
        reportFixture(
          "ATLETAS INATIVOS NA BASE DE DADOS (1)",
          ["M-014 | Synthetic Member Fourteen |  | 14 Apr 2014 |  | +4470014014 | 15 May 2020"],
          { header: inactiveEnglishHeader, inactive: true },
        ),
      ),
    ).toThrow(/language|header|compatible/i);
    expect(() =>
      parseMemberReport(
        reportFixture(
          "INACTIVE MEMBERS IN DATABASE (1)",
          ["M-015 | Synthetic Member Fifteen |  | 15 May 2015 |  | +4470015015"],
          { header: englishHeader },
        ),
      ),
    ).toThrow(/inactive|column|header/i);
    expect(() =>
      parseMemberReport(
        reportFixture(
          "ACTIVE MEMBERS IN DATABASE (1)",
          ["M-016 | Synthetic Member Sixteen |  | 16 Jun 2016 |  | +4470016016 | 17 Jul 2020"],
          { header: inactiveEnglishHeader, inactive: true },
        ),
      ),
    ).toThrow(/inactive|column|header/i);
  });

  it("accepts each approved English and Portuguese header only for its matching report language", () => {
    for (const report of Object.keys(englishTitles) as Array<keyof typeof englishTitles>) {
      for (const language of ["english", "portuguese"] as const) {
        const row =
          report === "inactive"
            ? "M-017 | Synthetic Layout Member | ID-017 | 17 Jul 2017 | VAT-017 | +4470017017 | 18 Aug 2020"
            : "M-017 | Synthetic Layout Member | ID-017 | 17 Jul 2017 | VAT-017 | +4470017017";
        const parsed = parseMemberReport(
          reportFixture(
            (language === "english" ? englishTitles : portugueseTitles)[report],
            [row],
            { header: headerFor(report, language) },
          ),
        );
        expect(parsed.report).toBe(report);
      }
    }
  });

  it("rejects pipe-delimited furniture and invalid data rows instead of treating them as members", () => {
    const cases = [
      "Member Nº | Name | ID Card Nº | Birthdate | VAT Number | Mobile nº",
      " | | | | | +4470018018",
      "*** | Synthetic Invalid Number | | 18 Aug 2018 | | +4470018018",
      "M-019 | | | 19 Sep 2019 | | +4470019019",
      "M-020 | Synthetic Invalid Columns | | 20 Oct 2020 |",
    ];
    for (const invalidRow of cases) {
      expect(() =>
        parseMemberReport(reportFixture("ACTIVE MEMBERS IN DATABASE (1)", [invalidRow])),
      ).toThrow(/header|row|name|number|column/i);
    }
  });

  it("deduplicates compatible rows, merges non-empty fields, and marks contradictions", () => {
    const reports: ParsedMemberReport[] = [
      parseMemberReport(
        reportFixture("ACTIVE MEMBERS IN DATABASE (1)", [
          "M-011 | Synthetic Member Eleven |  | 11 Nov 2011 |  | ",
        ]),
      ),
      parseMemberReport(
        reportFixture("REGULARIZED MEMBERS IN DATABASE (1)", [
          "m 011 | Synthetic Member Eleven | ID-011 | 11 Nov 2011 |  | +4470011011",
        ]),
      ),
      parseMemberReport(
        reportFixture("SUSPENDED MEMBERS IN DATABASE (1)", [
          "M-011 | Synthetic Different Eleven |  | 11 Nov 2011 |  | ",
        ]),
      ),
    ];

    const result = deduplicateMemberRows(reports);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      membershipNumber: "M-011",
      idCardNumber: "ID-011",
      mobileNumber: "+4470011011",
      paymentStatus: "regularized",
    });
    expect(result.duplicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "duplicate" }),
        expect.objectContaining({ kind: "conflict" }),
      ]),
    );
  });

  it("resolves status overlap with suspended taking precedence over active", () => {
    const active = parseMemberReport(
      reportFixture("ACTIVE MEMBERS IN DATABASE (1)", [
        "M-021 | Synthetic Status Member |  | 21 Jan 2021 |  | ",
      ]),
    );
    const suspended = parseMemberReport(
      reportFixture("SUSPENDED MEMBERS IN DATABASE (1)", [
        "M-021 | Synthetic Status Member |  | 21 Jan 2021 |  | ",
      ]),
    );

    const result = deduplicateMemberRows([active, suspended]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ membershipStatus: "suspended" });
    expect(result.duplicates).toEqual([expect.objectContaining({ kind: "duplicate" })]);
  });

  it("keeps inactive status differences as conflicts instead of resolving them", () => {
    const active = parseMemberReport(
      reportFixture("ACTIVE MEMBERS IN DATABASE (1)", [
        "M-022 | Synthetic Status Conflict |  | 22 Feb 2022 |  | ",
      ]),
    );
    const inactive = parseMemberReport(
      reportFixture(
        "INACTIVE MEMBERS IN DATABASE (1)",
        ["M-022 | Synthetic Status Conflict |  | 22 Feb 2022 |  |  | 23 Feb 2023"],
        { inactive: true },
      ),
    );
    const suspended = parseMemberReport(
      reportFixture("SUSPENDED MEMBERS IN DATABASE (1)", [
        "M-022 | Synthetic Status Conflict |  | 22 Feb 2022 |  | ",
      ]),
    );

    expect(deduplicateMemberRows([active, inactive]).duplicates).toEqual([
      expect.objectContaining({ kind: "conflict", fields: ["membershipStatus"] }),
    ]);
    expect(deduplicateMemberRows([inactive, suspended]).duplicates).toEqual([
      expect.objectContaining({ kind: "conflict", fields: ["membershipStatus"] }),
    ]);
  });

  it("uses a deterministic fingerprint for repeated rows without identifiers", () => {
    const report = parseMemberReport(
      reportFixture("MEMBERS WITHOUT MEMBER NUMBER IN DATABASE (1)", [
        " | Synthetic Member Twelve | ID-012 | 12 Dec 2012 | VAT-012 | +4470012012",
      ]),
    );

    const first = deduplicateMemberRows([report, report]);
    const second = deduplicateMemberRows([report, report]);

    expect(first.rows).toHaveLength(1);
    expect(first.duplicates).toEqual(second.duplicates);
    expect(first.duplicates[0]).toMatchObject({ kind: "duplicate" });
  });

  it("falls back to email for future synthetic rows and includes report keys in source rows", () => {
    const row = (
      sourceReport: ParsedMemberRow["sourceReport"],
      sourceRowNumber: number,
      overrides: Partial<ParsedMemberRow> = {},
    ): ParsedMemberRow => ({
      sourceReport,
      sourceRowNumber,
      fullName: "Synthetic Email Member",
      email: "synthetic@example.test",
      ...overrides,
    });
    const reports: ParsedMemberReport[] = [
      { report: "total", declaredCount: 1, rows: [row("total", 1)], sourceHash: "a" },
      {
        report: "active",
        declaredCount: 1,
        rows: [row("active", 1, { mobileNumber: "+4470021001" })],
        sourceHash: "b",
      },
    ];

    const result = deduplicateMemberRows(reports);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toHaveProperty("mobileNumber", "+4470021001");
    expect(result.duplicates[0]).toMatchObject({
      kind: "duplicate",
      sourceRows: ["total:1", "active:1"],
    });
  });

  it("decodes common accented HTML entities without treating markup as executable", () => {
    const parsed = parseMemberReport(
      reportFixture("TOTAL MEMBERS IN DATABASE (1)", [
        "M-021 | Synthetic M&eacute;mber | ID-021 | 21 Nov 2021 | VAT-021 | +4470021021",
      ]),
    );

    expect(parsed.rows[0]).toHaveProperty("fullName", "Synthetic Mémber");
  });
});
