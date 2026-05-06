-- 048_dept_contact_type.sql
-- Classify "Not Set" users as B2B/B2C using department mapping from Google Sheets.
-- Stores classification locally in departments + dept_emails tables,
-- then propagates to users via chat history, email, and phone matching.

-- ============================================================
-- 1a. Add contact_type columns
-- ============================================================
ALTER TABLE departments ADD COLUMN IF NOT EXISTS contact_type VARCHAR(10);
ALTER TABLE dept_emails ADD COLUMN IF NOT EXISTS contact_type VARCHAR(10);

-- ============================================================
-- 1b. Populate departments.contact_type from Google Sheet 2
--     Key: (orig_id, source)
-- ============================================================
UPDATE departments d SET contact_type = v.ct
FROM (VALUES
  -- db1 departments (94 rows)
  (1,   'db1', 'B2B'),   -- CDESK Testing Department
  (7,   'db1', 'B2C'),   -- B2C Sales Support Dept.
  (8,   'db1', 'B2B'),   -- HR Pune
  (9,   'db1', 'B2B'),   -- B2B Balloon Flights Sales Support
  (11,  'db1', 'B2B'),   -- B2B Drive The Thrill Sales Support
  (12,  'db1', 'B2B'),   -- Guest Experience
  (13,  'db1', 'B2B'),   -- B2B Visa Typing Dept.
  (14,  'db1', 'B2B'),   -- Visa Typing Dept.
  (15,  'db1', 'B2B'),   -- B2B India FIT Sales Support Dept.
  (16,  'db1', 'B2B'),   -- B2B ROW & Africa Sales Support Dept.
  (17,  'db1', 'B2B'),   -- Compliance Support Dept.
  (18,  'db1', 'B2B'),   -- Hotel Reservation Dept.
  (19,  'db1', 'B2C'),   -- B2C Drive The Thrill Sales Support
  (20,  'db1', 'B2B'),   -- International Visa Typing Dept.
  (21,  'db1', 'B2B'),   -- Hotel Contracting Dept.
  (22,  'db1', 'B2B'),   -- B2B UAE Sales Support Dept.
  (23,  'db1', 'B2B'),   -- Customer Support Dept.
  (24,  'db1', 'B2B'),   -- BRMS_queries_B2B Department
  (25,  'db1', 'B2C'),   -- B2C Balloon Flights Sales Support
  (27,  'db1', 'B2C'),   -- B2C International Visa Sales Support Dept.
  (33,  'db1', 'B2B'),   -- Hotel Res. Online Dept.
  (110, 'db1', 'B2B'),   -- B2B Pegas Sales Support Dept.
  (29,  'db1', 'B2B'),   -- B2B India Billing Dept.
  (30,  'db1', 'B2B'),   -- B2B UAE Res Dept.
  (31,  'db1', 'B2B'),   -- Middle East & Turkey Sales Support
  (34,  'db1', 'B2B'),   -- B2B Bali Sales Support
  (36,  'db1', 'B2B'),   -- Receivable Department (Accounts)
  (37,  'db1', 'B2B'),   -- B2B Telemarketing Dept.
  (38,  'db1', 'B2B'),   -- Top Up Dept. (Accounts)
  (40,  'db1', 'B2B'),   -- Payroll Dept. INDIA
  (42,  'db1', 'B2B'),   -- Rayna DMC Product Dept. | Excursions
  (43,  'db1', 'B2B'),   -- DSD Sales Support Dept.
  (44,  'db1', 'B2B'),   -- Refund Dept. (Accounts)
  (45,  'db1', 'B2B'),   -- B2B Africa & ROW Billing Dept.
  (52,  'db1', 'B2B'),   -- B2B GCC & Israel FIT Sales Support Dept.
  (54,  'db1', 'B2B'),   -- B2B GCC & Israel GIT Sales Support Dept.
  (55,  'db1', 'B2B'),   -- B2B AUH Sales Support Dept.
  (57,  'db1', 'B2B'),   -- Payable Dept. (Accounts)
  (58,  'db1', 'B2B'),   -- B2B Thailand Sales Support Dept.
  (70,  'db1', 'B2B'),   -- B2B Singapore Sales Support
  (65,  'db1', 'B2B'),   -- Tickets Canc. Support Dept.
  (61,  'db1', 'B2B'),   -- Tax Dept. (Accounts)
  (63,  'db1', 'B2B'),   -- Rayna Corporate Sales Support
  (66,  'db1', 'B2B'),   -- Arabian Explorers RES
  (67,  'db1', 'B2B'),   -- B2B Outbound Sales Support Dept.
  (69,  'db1', 'B2B'),   -- B2B Luxury Sales Support Dept.
  (68,  'db1', 'B2C'),   -- VIP Concierge Support
  (112, 'db1', 'B2C'),   -- Luxury Car Rental Sales Support
  (73,  'db1', 'B2B'),   -- B2B Visa Sales Support Dept.
  (75,  'db1', 'B2B'),   -- Visa Coordination Support Dept.
  (71,  'db1', 'B2B'),   -- Concierge4u Support
  (72,  'db1', 'B2B'),   -- B2B INDIA Online Support
  (74,  'db1', 'B2B'),   -- Demo Department
  (76,  'db1', 'B2B'),   -- Payment Confirmation Dept. (Accounts)
  (77,  'db1', 'B2B'),   -- B2C Billing Dept.
  (105, 'db1', 'B2C'),   -- B2C Outbound Holiday Package Dept.
  (78,  'db1', 'B2B'),   -- Arabian Explorers Sales Support Dept.
  (79,  'db1', 'B2B'),   -- TD Corporate Support
  (80,  'db1', 'B2C'),   -- B2C Attractions.com
  (81,  'db1', 'B2C'),   -- B2C Customer Support
  (82,  'db1', 'B2B'),   -- Visa Overstay Department
  (83,  'db1', 'B2C'),   -- B2C-Affiliates
  (84,  'db1', 'B2B'),   -- B2C Testing Dept.
  (85,  'db1', 'B2B'),   -- B2B India Seacation
  (86,  'db1', 'B2B'),   -- B2B Europe Sales Support
  (87,  'db1', 'B2C'),   -- Only Dubai Visa Department
  (88,  'db1', 'B2B'),   -- B2B India GIT Sales Support Dept.
  (89,  'db1', 'B2C'),   -- Rayna Corporate - Int. Visa Support
  (90,  'db1', 'B2B'),   -- Air Ticketing Sales Support Dept.
  (91,  'db1', 'B2B'),   -- Internal Query Support
  (92,  'db1', 'B2B'),   -- B2B India Domestic Sales Support
  (93,  'db1', 'B2B'),   -- Online Visa Sales Support Dept.
  (101, 'db1', 'B2B'),   -- Payroll Dept. | UAE
  (94,  'db1', 'B2B'),   -- B2B UAE Seacation
  (95,  'db1', 'B2B'),   -- B2B Saudi Seacation
  (96,  'db1', 'B2C'),   -- Seacation Operation
  (97,  'db1', 'B2B'),   -- Hotel Res. Group Dept.
  (98,  'db1', 'B2B'),   -- Saudi Arabia Sales Support
  (99,  'db1', 'B2B'),   -- South East Asia Support
  (100, 'db1', 'B2B'),   -- VIP Concierge Desk Support
  (102, 'db1', 'B2C'),   -- B2C SEA - INDIA
  (103, 'db1', 'B2C'),   -- B2C SEA - UAE
  (104, 'db1', 'B2C'),   -- Only Dubai Visa South Africa
  (106, 'db1', 'B2B'),   -- B2B Vietnam Sales Support
  (108, 'db1', 'B2B'),   -- Hotel Sales Support
  (109, 'db1', 'B2B'),   -- Ticket Sales Support
  (111, 'db1', 'B2C'),   -- Shore Excursions Sales Support Dept.
  (114, 'db1', 'B2B'),   -- Travel Desk Support
  (113, 'db1', 'B2C'),   -- B2C Domestic Sales Support
  (115, 'db1', 'B2C'),   -- B2B Air Ticketing Sales Support
  (116, 'db1', 'B2B'),   -- Rayna Properties Sales Support
  (117, 'db1', 'B2C'),   -- Seacation Sales Support Dept.
  (118, 'db1', 'B2B'),   -- Payments Dept (Accounts)
  (119, 'db1', 'B2C'),   -- B2C Operations
  -- db2 departments (79 rows)
  (2,   'db2', 'B2C'),   -- B2C Sales Support | 971564337939
  (4,   'db2', 'B2B'),   -- B2B UAE Marketing
  (119, 'db2', 'B2C'),   -- Int. Visa - UAE Sales
  (5,   'db2', 'B2B'),   -- Customer Support | 97142087111
  (6,   'db2', 'B2B'),   -- CDESK Support | 97142087100
  (7,   'db2', 'B2B'),   -- Malik
  (14,  'db2', 'B2B'),   -- Malik (desc)
  (15,  'db2', 'B2C'),   -- B2C Sales Whatsapp
  (16,  'db2', 'B2B'),   -- Rayna Social Media Support | 97142087255
  (17,  'db2', 'B2C'),   -- Seacation Sales | 97142087277
  (18,  'db2', 'B2C'),   -- OLD B2C Marketing | 971501067625
  (19,  'db2', 'B2B'),   -- Rayna Properties Marketing | 971547752771
  (20,  'db2', 'B2C'),   -- Rayna Tours Holidays | 971524075591
  (21,  'db2', 'B2B'),   -- Rayna B2B Africa Sales | 97142087404
  (22,  'db2', 'B2C'),   -- Seacation Marketing OLD
  (23,  'db2', 'B2B'),   -- B2B India Marketing
  (32,  'db2', 'B2C'),   -- Seacation Marketing
  (33,  'db2', 'B2B'),   -- Corporate Sales
  (60,  'db2', 'B2C'),   -- Seacation Sales
  (34,  'db2', 'B2B'),   -- Chat Head Support
  (36,  'db2', 'B2B'),   -- RaynaTours Yacht Sales
  (37,  'db2', 'B2B'),   -- B2B India Marketing (912066838852)
  (38,  'db2', 'B2B'),   -- Customer Support (97142087112)
  (39,  'db2', 'B2C'),   -- Corporate Marketing
  (40,  'db2', 'B2C'),   -- B2C Marketing
  (41,  'db2', 'B2C'),   -- Rayna Arabia Marketing
  (48,  'db2', 'B2C'),   -- Rayna Events
  (49,  'db2', 'B2C'),   -- Balloon Flights Sales
  (50,  'db2', 'B2C'),   -- Deep Sea Adventure
  (51,  'db2', 'B2C'),   -- Drive The Thrill Sales
  (58,  'db2', 'B2C'),   -- TD Corporate Support
  (59,  'db2', 'B2C'),   -- Corporate - Int. Visa
  (99,  'db2', 'B2B'),   -- TopUp Support
  (105, 'db2', 'B2C'),   -- Concierge4u Support
  (100, 'db2', 'B2B'),   -- B2B India Sales
  (101, 'db2', 'B2B'),   -- B2B India Seacation
  (102, 'db2', 'B2B'),   -- B2B UAE Sales
  (103, 'db2', 'B2B'),   -- B2B Visa Sales
  (104, 'db2', 'B2B'),   -- Guest Experience
  (106, 'db2', 'B2C'),   -- Online Travel Portal
  (107, 'db2', 'B2C'),   -- Digital Concierge
  (112, 'db2', 'B2C'),   -- B2C Outbound Sales
  (113, 'db2', 'B2C'),   -- B2C Outbound Marketing
  (116, 'db2', 'B2C'),   -- Saudi Arabia Sales
  (120, 'db2', 'B2C'),   -- Int. Visa - India Sales
  (121, 'db2', 'B2C'),   -- B2C Sales
  (122, 'db2', 'B2C'),   -- Abu Dhabi Sales
  (123, 'db2', 'B2C'),   -- Micro Web. Int. Visa
  (124, 'db2', 'B2C'),   -- B2C Events & Concerts
  (137, 'db2', 'B2C'),   -- Desert Safari Dubai
  (140, 'db2', 'B2C'),   -- Travel Desk Support
  (141, 'db2', 'B2C'),   -- Travel Concierge Support
  (142, 'db2', 'B2C'),   -- B2C Holidays From India
  (143, 'db2', 'B2C'),   -- Rayna Holidays From India
  (144, 'db2', 'B2C'),   -- RAK Sales Support
  (145, 'db2', 'B2C'),   -- VIP Concierge Desk
  (146, 'db2', 'B2C'),   -- SEA India
  (147, 'db2', 'B2C'),   -- SEA UAE
  (152, 'db2', 'B2C'),   -- SEA Thailand
  (153, 'db2', 'B2C'),   -- SEA Vietnam
  (154, 'db2', 'B2C'),   -- SEA Indonesia
  (155, 'db2', 'B2C'),   -- Seacation Marketing India
  (180, 'db2', 'B2C'),   -- Rayna Middle East & Turkey
  (158, 'db2', 'B2C'),   -- B2C KSA
  (159, 'db2', 'B2B'),   -- B2B UAE Seacation
  (160, 'db2', 'B2C'),   -- Saudi Inbound Support
  (161, 'db2', 'B2C'),   -- Costa Cruise India
  (162, 'db2', 'B2B'),   -- Safari Coordination
  (163, 'db2', 'B2C'),   -- Dubai Visa Sales
  (164, 'db2', 'B2C'),   -- SEA Thailand UAE
  (165, 'db2', 'B2C'),   -- SEA Vietnam UAE
  (166, 'db2', 'B2C'),   -- SEA Indonesia UAE
  (173, 'db2', 'B2C'),   -- Balloon Flights Marketing
  (176, 'db2', 'B2B'),   -- B2B UAE Dutch Oriental
  (177, 'db2', 'B2B'),   -- Test
  (178, 'db2', 'B2C'),   -- B2C Domestic Support
  (179, 'db2', 'B2B'),   -- To and Fro Support
  (181, 'db2', 'B2B'),   -- Cloud Api
  (182, 'db2', 'B2C')    -- B2C Sales Support
) AS v(oid, src, ct)
WHERE d.orig_id = v.oid AND d.source = v.src;

-- ============================================================
-- 1c. Populate dept_emails.contact_type from Google Sheet 1
--     Key: email (unique)
-- ============================================================
UPDATE dept_emails SET contact_type = v.ct
FROM (VALUES
  ('noreply@raynatours.com', 'B2C'),
  ('ticketscancellation@raynatours.com', 'B2B'),
  ('inquiry@raynatours.com', 'B2C'),
  ('supplier@raynab2b.com', 'B2B'),
  ('info@drivethethrill.com', 'B2C'),
  ('tax@raynatours.com', 'B2B'),
  ('info@connectingdesk.com', 'B2B'),
  ('feedback@raynatours.com', 'B2B'),
  ('holidays@raynatours.com', 'B2C'),
  ('holidays@imonholidays.com', 'B2C'),
  ('b2ctyping@raynatours.com', 'B2B'),
  ('b2btyping@raynab2b.com', 'B2B'),
  ('query@raynab2b.com', 'B2B'),
  ('compliance@raynatours.com', 'B2B'),
  ('rates@raynab2b.com', 'B2B'),
  ('booking@attractions.ae', 'B2C'),
  ('contracting@raynab2b.com', 'B2B'),
  ('online@raynab2b.com', 'B2B'),
  ('emailer@raynab2b.com', 'B2B'),
  ('info@balloonflights.ae', 'B2C'),
  ('b2b@raynab2b.com', 'B2B'),
  ('res@raynab2b.com', 'B2B'),
  ('sales@raynab2b.com', 'B2B'),
  ('info@visitsingapore.in', 'B2C'),
  ('sales@desertsafaridubai.com', 'B2C'),
  ('info@usvisa.ae', 'B2C'),
  ('info@canadavisa.ae', 'B2C'),
  ('info@singaporevisa.ae', 'B2C'),
  ('info@germanyvisa.ae', 'B2C'),
  ('info@schengenvisa.ae', 'B2C'),
  ('info@ukvisa.ae', 'B2C'),
  ('info@europevisa.ae', 'B2C'),
  ('info@thailandvisa.ae', 'B2C'),
  ('info@italyvisa.ae', 'B2C'),
  ('info@malaysiavisa.ae', 'B2C'),
  ('info@imonholidays.com', 'B2C'),
  ('intvisas@raynatours.com', 'B2C'),
  ('billing@raynagroup.com', 'B2B'),
  ('reply@raynamails.com', 'B2B'),
  ('info@bookdubaivisa.com', 'B2C'),
  ('dxbvisa@raynatours.com', 'B2B'),
  ('b2bonline@raynab2b.com', 'B2B'),
  ('receivables@raynab2b.com', 'B2B'),
  ('info@toursinabudhabi.com', 'B2C'),
  ('telemarketing@raynab2b.com', 'B2B'),
  ('topup@raynab2b.com', 'B2B'),
  ('visa@raynab2b.com', 'B2B'),
  ('info@edubaishoppingfestival.com', 'B2C'),
  ('info@bookdhowcruisedubai.com', 'B2C'),
  ('info@dhowcruiseindubai.com', 'B2C'),
  ('info@bestdesertsafariindubai.com', 'B2C'),
  ('info@edubaivisa.in', 'B2C'),
  ('info@mydesertsafaridubai.com', 'B2C'),
  ('info@newyearpartydubai.com', 'B2C'),
  ('info@desertsafaridubaitrip.ae', 'B2C'),
  ('info@uktouristpackages.com', 'B2C'),
  ('info@dubaishoppingfestival2013.com', 'B2C'),
  ('info@raynatravelogue.com', 'B2C'),
  ('info@dubaishoppingfestival2017.com', 'B2C'),
  ('info@dubaishoppingfestivals2014.com', 'B2C'),
  ('payroll@raynatours.com', 'B2B'),
  ('airtravel@raynab2b.com', 'B2B'),
  ('groups@raynab2b.com', 'B2B'),
  ('visacoordination@raynatours.com', 'B2B'),
  ('dsd@raynatours.com', 'B2B'),
  ('refund@raynatours.com', 'B2B'),
  ('billing@raynab2b.com', 'B2B'),
  ('info@desertsafaridubai.com', 'B2C'),
  ('dcd@raynatours.com', 'B2B'),
  ('puneaccount@raynatours.com', 'B2B'),
  ('billing@raynatours.com', 'B2B'),
  ('queries@arabian-explorers.com', 'B2B'),
  ('fit@raynab2b.com', 'B2B'),
  ('auh@raynab2b.com', 'B2B'),
  ('payables@raynatours.com', 'B2B'),
  ('thailand@raynab2b.com', 'B2B'),
  ('support@raynatours.com', 'B2B'),
  ('inquiry@visitvisadubai.com', 'B2C'),
  ('vietnam@raynab2b.com', 'B2B'),
  ('singapore@raynab2b.com', 'B2B'),
  ('res@arabian-explorers.com', 'B2B'),
  ('vipconcierge@raynatours.com', 'B2C'),
  ('luxurytours@raynab2b.com', 'B2B'),
  ('info@turkeyvisa.ae', 'B2C'),
  ('enq@raynatours.com', 'B2B'),
  ('overstay@raynatours.com', 'B2B'),
  ('heta@raynatours.com', 'B2B'),
  ('boxoffice@raynatours.com', 'B2C'),
  ('inquiry@onlydubaivisa.com', 'B2C'),
  ('mice@raynab2b.com', 'B2B'),
  ('inboundindia@raynab2b.com', 'B2B'),
  ('globalvisa@raynatours.com', 'B2B'),
  ('internalquery@raynatours.com', 'B2C'),
  ('airticketing@raynatours.com', 'B2B'),
  ('onlinevisa@raynatours.com', 'B2C'),
  ('uaevisa@raynatours.com', 'B2C'),
  ('outbound@raynab2b.com', 'B2B'),
  ('b2bcruise@raynab2b.com', 'B2B'),
  ('cruisesaudi@raynatours.com', 'B2C'),
  ('cruiseoperation@raynatours.com', 'B2C'),
  ('grouprates@raynab2b.com', 'B2B'),
  ('saudi@raynatours.com', 'B2B'),
  ('quote@raynatours.com', 'B2C'),
  ('prioritytravel@raynatours.com', 'B2B'),
  ('attendance@raynatours.com', 'B2B'),
  ('vacations@raynatours.com', 'B2C'),
  ('info@raynatours.ae', 'B2B'),
  ('travel@raynatours.com', 'B2C'),
  ('info@imgworldstickets.ae', 'B2B'),
  ('hotelsales@raynab2b.com', 'B2B'),
  ('ticketsales@raynab2b.com', 'B2B'),
  ('pegas@raynab2b.com', 'B2B'),
  ('staycations@raynatours.com', 'B2B'),
  ('luxuryrental@toandfro.ae', 'B2C'),
  ('td@raynatours.com', 'B2C'),
  ('info@raynaproperties.com', 'B2B'),
  ('cruises@raynatours.com', 'B2C'),
  ('intvisatyping@raynatours.com', 'B2C'),
  ('payments@raynatours.com', 'B2B'),
  ('affiliates@raynatours.com', 'B2B'),
  ('inquiry@drivethethrill.com', 'B2C'),
  ('info@concierge4u.ae', 'B2C'),
  ('inquiry@balloonflights.ae', 'B2C'),
  ('shoreexcursions@raynatours.com', 'B2C'),
  ('resonline@raynab2b.com', 'B2B'),
  ('bookings@drivethethrill.com', 'B2C'),
  ('europe@raynab2b.com', 'B2B'),
  ('cruisevisa@raynatours.com', 'B2C'),
  ('corporatecruise@raynatours.com', 'B2C'),
  ('seasupport@raynatours.com', 'B2C'),
  ('indiaholidays@raynatours.com', 'B2C'),
  ('help@raynatours.com', 'B2C'),
  ('trips@raynatours.com', 'B2C'),
  ('enquiry@desertsafaridubai.com', 'B2C'),
  ('billing@desertsafaridubai.com', 'B2B'),
  ('hrpune@raynatours.com', 'B2B'),
  ('bali@raynab2b.com', 'B2B')
) AS v(em, ct)
WHERE LOWER(dept_emails.email) = LOWER(v.em);

-- ============================================================
-- 1d. Classify users — Strategy 1: Chat → Department
--     chat_contacts.departments stores dept phone numbers.
--     Unnest, join to departments.connection, classify.
--     B2C wins if ANY department is B2C.
-- ============================================================
WITH user_dept_types AS (
  SELECT DISTINCT c.user_id, d.contact_type
  FROM chats c
  JOIN chat_contacts cc ON c.wa_id = cc.wa_id
  CROSS JOIN LATERAL unnest(string_to_array(cc.departments, ',')) AS dept_conn
  JOIN departments d ON TRIM(dept_conn) = d.connection
  WHERE c.user_id IS NOT NULL
    AND d.contact_type IS NOT NULL
),
user_classification AS (
  SELECT user_id,
    CASE WHEN bool_or(contact_type = 'B2C') THEN 'B2C' ELSE 'B2B' END AS ct
  FROM user_dept_types
  GROUP BY user_id
)
UPDATE users u SET contact_type = uc.ct
FROM user_classification uc
WHERE u.id = uc.user_id
  AND (u.contact_type IS NULL OR u.contact_type = '');

-- ============================================================
-- 1e. Classify users — Strategy 2: Email match
-- ============================================================
UPDATE users u SET contact_type = de.contact_type
FROM user_emails ue
JOIN dept_emails de ON LOWER(ue.email) = LOWER(de.email)
WHERE ue.user_id = u.id
  AND (u.contact_type IS NULL OR u.contact_type = '')
  AND de.contact_type IS NOT NULL;

-- ============================================================
-- 1f. Classify users — Strategy 3: Phone match
-- ============================================================
UPDATE users u SET contact_type = d.contact_type
FROM user_phones up
JOIN departments d ON RIGHT(REGEXP_REPLACE(up.phone, '[^0-9]', '', 'g'), 10)
                    = RIGHT(REGEXP_REPLACE(d.connection, '[^0-9]', '', 'g'), 10)
WHERE up.user_id = u.id
  AND (u.contact_type IS NULL OR u.contact_type = '')
  AND d.contact_type IS NOT NULL
  AND d.connection IS NOT NULL
  AND d.connection != '';
