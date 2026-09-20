# Lead Finder filters

Used by `POST /lead-finder/search`, `/lead-finder/count` and `/lead-finder/export`.

## Request shape

```json
{
  "filters": { "jobLevel": ["VP", "Director"], "countryName": ["United States"] },
  "excludeFilters": { "jobTitle": ["Intern"], "domain": ["competitor.com"] },
  "page": 1,
  "pageSize": 25
}
```

- `filters` is required. `page` starts at 1; `pageSize` 1–100 (default 25).
- `excludeFilters` only supports `personHeadline`, `companyHeadline`, `aboutUs`, `domain`, `jobTitle`.
- Free: first 3 pages or 75 results per search, whichever comes first (so a bigger `pageSize` does not get more free rows), and 50 free unique searches per month. Paging or re-running the same filters does not use another free search. Page 4+ costs 1 credit per result, max 40 pages.

## Matching rules

- List values are matched **exactly and case-sensitively**. `"vp"` matches nothing; `"VP"` works.
- Values inside one filter are OR-ed; different filters are AND-ed.
- An unknown value is not an error — it just returns zero rows. If a count is unexpectedly 0, suspect a value typo first.
- `personHeadline`, `companyHeadline`, `aboutUs` are **contains** matches and accept any keyword. Use these for fuzzy intent ("fintech", "head of growth").
- `jobTitle` is exact match, so `"VP of Engineering"` misses `"VP Engineering"`. Prefer `jobLevel` + `jobFunction`, or pass several title variants.
- `companyName` is exact by default; set `"companyNameMode": "contains"` for partial matching. Use `GET /lead-finder/suggest?q=strip&limit=10` (company name autocomplete, free) to get exact names.
- `GET /lead-finder/filter-options` (free) is the source of truth for allowed values; it refreshes monthly. Each entry looks like `{ "label", "category", "mode", "values": [...], "maxSelections" }`.

## Most useful filters

### Person
| Filter | Type | Notes |
|---|---|---|
| `jobLevel` | string[] | `C-Team`, `VP`, `Director`, `Manager`, `Staff`, `Other` |
| `jobFunction` | string[] | department, 22 values below |
| `jobTitle` | string[] | exact match |
| `personHeadline` | string[] | contains match on LinkedIn headline |
| `skills` | string[] | exact match |
| `languages` | string[] | |
| `firstName`, `lastName` | string | exact |
| `linkedinUrl` | string | exact; find one specific person |
| `emailDomain`, `emailAddress` | string | exact |
| `jobIsCurrent` | boolean | |
| `countryName` / `countryCode` | string[] | person location, e.g. `United States`, `India` / `US`, `IN` |
| `stateName` / `stateCode` | string[] | |
| `city` | string | exact |
| `continent` | string[] | `Africa`, `Antarctica`, `Asia`, `Europe`, `North America`, `Oceania`, `South America` |
| `countryRegion` | string[] | `APAC`, `EMEA`, `LATAM`, `NORAM` |

`jobFunction` values: `Advertising & Marketing`, `Art, Culture and Creative Professionals`, `Construction`, `Customer/Client Service`, `Education`, `Engineering`, `Finance & Accounting`, `General Business & Management`, `Healthcare & Human Services`, `Human Resources`, `Information Technology`, `Legal`, `Manufacturing & Production`, `Operations`, `Other`, `Public Administration & Safety`, `Purchasing`, `Research & Development`, `Sales & Business Development`, `Science`, `Supply Chain & Logistics`, `Writing/Editing`

### Company
| Filter | Type | Notes |
|---|---|---|
| `domain` | string[] | company domains, up to 5000 — best way to target an account list |
| `companyName` (+ `companyNameMode`) | string[] | |
| `employeeCountMin` / `employeeCountMax` | integer | headcount range |
| `revenueBuckets` | string[] | `<$1M`, `$1M to <$10M`, `$10M to <$50M`, `$50M to <$100M`, `$100M to <$1B`, `$1B+` |
| `revenueMin` / `revenueMax` | number | |
| `linkedinIndustry` | string[] | 454 values (e.g. `Accounting`, `Software Development`) — fetch from filter-options |
| `industrySicCode` / `industrySicDescription` | string[] | ~1,010 values |
| `industryNaicsCode` / `industryNaicsDescription` | string[] | ~1,000–1,200 values |
| `aboutUs`, `companyHeadline` | string[] | contains match on company description |
| `companyEntityType` | string[] | `Educational`, `Educational Institution`, `Government Agency`, `Nonprofit`, `Partnership`, `Privately Held`, `Public Company`, `Self-Employed`, `Self-Owned`, `Sole Proprietorship` |
| `foundedOn` | number | exact year |
| `headquartersCountry`, `locationCountry` | string[] | |
| `headquartersCity`, `headquartersState` | string | exact |

### Funding and growth
| Filter | Type | Notes |
|---|---|---|
| `lastFundingTypeOrg` | string[] | `Pre Seed Round`, `Seed Round`, `Angel Round`, `Series A` … `Series J`, `Venture Round`, `Private Equity Round`, `Debt Financing`, `Grant`, `Post-IPO Equity`, etc. |
| `lastFundingAmountOrg`, `totalFundingAmountOrg` | number | minimum |
| `employeeOnLinkedinGrowthRateOrg` | number | minimum growth rate |
| `totalMonthlyTrafficOrg`, `monthlyOrganicTrafficOrg`, `monthlyPaidTrafficOrg`, `monthlyGoogleAdspendOrg` | number | minimums |

### Tech stack (company uses…)
| Filter | Values |
|---|---|
| `crmTechOrg` | `Hubspot`, `Microsoft Dynamics`, `Pipedrive CRM`, `Salesforce CRM`, `SugarCRM`, `Zoho` |
| `marketingAutomationTechOrg` | `Hubspot`, `Klaviyo`, `Mailchimp`, `Marketo`, `Pardot`, `Salesforce Marketing Cloud` |
| `salesAutomationTechOrg` | `Apollo`, `Outreach`, `Salesloft`, `Yesware` |
| `cmsTechOrg` | `Adobe CQ`, `Adobe Experience Manager`, `Contentful`, `Drupal`, `Episerver`, `Hubspot`, `Optimizely`, `Prismic`, `Sanity`, `Sitecore`, `Squarespace`, `Strapi`, `Wix`, `Wordpress` |
| `eCommercePlatformTechOrg` | `BigCommerce`, `Oracle Commerce`, `Salesforce Commerce Cloud`, `Shopify`, `WooCommerce` |
| `cloudProviderTechOrg` | `AWS`, `Alibaba`, `Google Cloud`, `IBM Cloud`, `Microsoft Azure`, `Oracle Cloud` |
| `analyticsTechOrg` | `Looker`, `Power BI`, `Qlik`, `Segment`, `Tableau` |
| `emailHostingTechOrg` | `Google`, `Microsoft` |
| others | `abmTechOrg`, `conversationIntelligenceTechOrg`, `developmentTechOrg`, `erpTechOrg`, `emailSecurityTechOrg`, `applicationSecurityTechOrg`, `cloudSecurityTechOrg`, `martechCategoriesOrg` — get values from filter-options |

### Hiring and team-size signals (all integer minimums)
`salesRoleCountOrg`, `marketingRoleCountOrg`, `engineerRoleCountOrg`, `itRoleCountOrg`, `securityRoleCountOrg`, `devopsRoleCountOrg`, `customerSuccessRoleCountOrg` … and open-role counts: `salesOpenRolesCountOrg`, `accountExecutiveOpenRolesCountOrg`, `marketingOpenRolesCountOrg`, `itOpenRolesCountOrg`, `securityOpenRolesCountOrg`, `devopsOpenRolesCountOrg`, etc. Booleans: `hasMobileAppOrg`, `hasWebAppOrg`, `hasCisoOrg`, `hasCioOrg`.

## Result row (preview)

`id` (`enc_…`, pass this to reveal), `firstName`, `lastName` (masked, e.g. `C.`), `jobTitle`, `jobFunction`, `jobLevel`, `linkedinUrl`, `linkedinHeadline`, `skills`, `city`, `stateName`, `countryName`, `companyName`, `domain`, `emailDomain`, `orgLinkedinUrl`, `employeeCount`, `revenue`, `industrySicDescription`, `industryNaicsDescription`, `specialties`, `foundedOn`, `headquartersCity/State/Country`, funding and traffic fields.

`pagination`: `page`, `pageSize`, `totalResults`, `totalPages`, `hasMore`.

## Example ICPs

Heads of sales at funded US SaaS startups using HubSpot:
```json
{"filters":{"jobLevel":["C-Team","VP","Director"],"jobFunction":["Sales & Business Development"],
 "countryName":["United States"],"employeeCountMin":20,"employeeCountMax":200,
 "lastFundingTypeOrg":["Seed Round","Series A","Series B"],"crmTechOrg":["Hubspot"]}}
```

Marketing leaders at Shopify stores in Europe:
```json
{"filters":{"jobFunction":["Advertising & Marketing"],"jobLevel":["VP","Director","Manager"],
 "continent":["Europe"],"eCommercePlatformTechOrg":["Shopify"]}}
```

Decision makers at a specific account list:
```json
{"filters":{"domain":["stripe.com","figma.com"],"jobLevel":["C-Team","VP"]}}
```

Founders by keyword (fuzzy):
```json
{"filters":{"personHeadline":["founder","co-founder"],"countryName":["India"],"employeeCountMax":50}}
```
