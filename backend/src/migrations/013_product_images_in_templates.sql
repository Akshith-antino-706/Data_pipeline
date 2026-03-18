-- ═══════════════════════════════════════════════════════════════════
-- Migration 013: Add product images to content templates
-- Updates email templates with real Rayna Tours product images
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- Add media_url (hero image) for each email template based on segment type
-- Using real product images from Rayna Tours CDN

-- Awareness stage templates — Desert Safari hero images
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg'
WHERE segment_label = 'Social Ad Leads' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg'
WHERE segment_label = 'Social Ad Leads' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Waterworld-111/1760000465432_3_2.jpg'
WHERE segment_label = 'Website Browsers' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Waterworld-111/1760000465432_3_2.jpg'
WHERE segment_label = 'Website Browsers' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg'
WHERE segment_label = 'WhatsApp First-Touch' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg'
WHERE segment_label = 'WhatsApp First-Touch' AND channel = 'whatsapp';

-- Consideration stage — engaging product images
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg'
WHERE segment_label LIKE 'Fresh Cart%' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg'
WHERE segment_label LIKE 'Fresh Cart%' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Marina-Circuit-Tour-4701/1760684751126_3_2.jpg'
WHERE segment_label LIKE 'Stale Cart%' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Marina-Circuit-Tour-4701/1760684751126_3_2.jpg'
WHERE segment_label LIKE 'Stale Cart%' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg'
WHERE segment_label = 'Active Enquirers' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg'
WHERE segment_label = 'Active Enquirers' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Quad-Biking-Abu-Dhabi-239/1725540641865_S.jpg'
WHERE segment_label = 'Hesitant Browsers' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Quad-Biking-Abu-Dhabi-239/1725540641865_S.jpg'
WHERE segment_label = 'Hesitant Browsers' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Camel-Trekking-in-Abu-Dhabi-183/1725538509936_S.jpg'
WHERE segment_label = 'Payment Failed' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Camel-Trekking-in-Abu-Dhabi-183/1725538509936_S.jpg'
WHERE segment_label = 'Payment Failed' AND channel = 'whatsapp';

-- Conversion stage
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Overnight-Safari-Abu-Dhabi-176/1725538156537_S.jpg'
WHERE segment_label = 'Registered Not Booked' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Overnight-Safari-Abu-Dhabi-176/1725538156537_S.jpg'
WHERE segment_label = 'Registered Not Booked' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Waterworld-111/1760000465432_3_2.jpg'
WHERE segment_label = 'New Customers (0-30 days)' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Waterworld-111/1760000465432_3_2.jpg'
WHERE segment_label = 'New Customers (0-30 days)' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg'
WHERE segment_label = 'Post-Trip Review Window' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg'
WHERE segment_label = 'Post-Trip Review Window' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg'
WHERE segment_label = 'One-Time Buyers (31-90 days)' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg'
WHERE segment_label = 'One-Time Buyers (31-90 days)' AND channel = 'whatsapp';

-- Growth stage — premium imagery
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Marina-Circuit-Tour-4701/1760684751126_3_2.jpg'
WHERE segment_label = 'Repeat Buyers' AND channel = 'email';
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Marina-Circuit-Tour-4701/1760684751126_3_2.jpg'
WHERE segment_label = 'Repeat Buyers' AND channel = 'whatsapp';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Helicopter-Ride-in-Abu-Dhabi-508786/helicopter-ride-in-abu-dhabi-front_3_2.jpg'
WHERE segment_label = 'Frequent Travelers (4+ bookings)';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Helicopter-Ride-in-Abu-Dhabi-508786/helicopter-ride-in-abu-dhabi-front_3_2.jpg'
WHERE segment_label = 'High Spenders (5000+ AED)';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Camel-Trekking-in-Abu-Dhabi-183/1725538509936_S.jpg'
WHERE segment_label LIKE 'Visa-Only%';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Quad-Biking-Abu-Dhabi-239/1725540641865_S.jpg'
WHERE segment_label LIKE 'Tour-Only%';

-- Win-Back stage — aspirational imagery to entice return
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Overnight-Safari-Abu-Dhabi-176/1725538156537_S.jpg'
WHERE segment_label LIKE 'Cooling Down%';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg'
WHERE segment_label LIKE 'At Risk%';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg'
WHERE segment_label LIKE 'Hibernating%';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Helicopter-Ride-in-Abu-Dhabi-508786/helicopter-ride-in-abu-dhabi-front_3_2.jpg'
WHERE segment_label LIKE 'Lost High-Value%';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Waterworld-111/1760000465432_3_2.jpg'
WHERE segment_label LIKE 'Lost Regular%';

-- Advocacy stage
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Marina-Circuit-Tour-4701/1760684751126_3_2.jpg'
WHERE segment_label LIKE 'Happy Reviewers%';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Quad-Biking-Abu-Dhabi-239/1725540641865_S.jpg'
WHERE segment_label = 'Social Media Advocates';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg'
WHERE segment_label = 'NPS Promoters';

-- Special stage
UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Overnight-Safari-Abu-Dhabi-176/1725538156537_S.jpg'
WHERE segment_label = 'B2B & Corporate';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Waterworld-111/1760000465432_3_2.jpg'
WHERE segment_label = 'Birthday Month';

UPDATE content_templates SET media_url = 'https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Camel-Trekking-in-Abu-Dhabi-183/1725538509936_S.jpg'
WHERE segment_label = 'High Cancellation Risk';


-- ══════════════════════════════════════════════════════════════
-- Now update email templates with rich HTML bodies containing
-- real product images and Rayna Tours branding
-- ══════════════════════════════════════════════════════════════

-- Update all email templates with professional HTML layout
-- Using a common wrapper with Rayna branding colors (orange #f97316)

-- Win-Back emails get the richest product content since that's the core goal

-- At Risk email - rich HTML with product cards
UPDATE content_templates SET body = '<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
  <tr><td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:32px 40px;text-align:center;">
    <div style="color:#fff;font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">Rayna Tours</div>
    <div style="color:#fff;font-size:26px;font-weight:800;margin-top:12px;line-height:1.3;">We Miss You! 💝</div>
    <div style="color:#fed7aa;font-size:14px;margin-top:8px;">Here''s 15% off to welcome you back</div>
  </td></tr>
  <tr><td style="padding:24px 32px;">
    <p style="font-size:15px;color:#334155;line-height:1.6;">Hi {{first_name}},</p>
    <p style="font-size:15px;color:#334155;line-height:1.6;">It''s been a while since your last adventure with us. We''ve added amazing new experiences since then!</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr><td style="padding:8px 0;">
        <table width="100%" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td width="140"><img src="https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Desert-Safari-Abu-Dhabi-174/1725536448099_S.jpg" width="140" height="100" style="display:block;object-fit:cover;" /></td>
          <td style="padding:12px 16px;"><div style="font-size:15px;font-weight:700;color:#1e293b;">Desert Safari Abu Dhabi</div><div style="font-size:12px;color:#64748b;margin:4px 0;">Abu Dhabi · desert safari tours</div><div style="margin-top:6px;"><span style="text-decoration:line-through;color:#94a3b8;font-size:13px;">AED 300</span> <span style="font-size:16px;font-weight:700;color:#f97316;">AED 190</span> <span style="background:#fef3c7;color:#d97706;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">37% OFF</span></div><a href="https://www.raynatours.com/abu-dhabi/desert-safari-tours/desert-safari-abu-dhabi-e-174" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#f97316;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">Book Now</a></td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:8px 0;">
        <table width="100%" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td width="140"><img src="https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/false-241/dhow-cruise-dinner-in-abu-dhabi-front.jpg" width="140" height="100" style="display:block;object-fit:cover;" /></td>
          <td style="padding:12px 16px;"><div style="font-size:15px;font-weight:700;color:#1e293b;">Dhow Cruise Abu Dhabi</div><div style="font-size:12px;color:#64748b;margin:4px 0;">Abu Dhabi · dhow cruise</div><div style="margin-top:6px;"><span style="text-decoration:line-through;color:#94a3b8;font-size:13px;">AED 240</span> <span style="font-size:16px;font-weight:700;color:#f97316;">AED 199</span> <span style="background:#fef3c7;color:#d97706;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">17% OFF</span></div><a href="https://www.raynatours.com/abu-dhabi/dhow-cruise/dhow-cruise-abu-dhabi-e-241" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#f97316;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">Book Now</a></td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:8px 0;">
        <table width="100%" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td width="140"><img src="https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Yas-Waterworld-111/1760000465432_3_2.jpg" width="140" height="100" style="display:block;object-fit:cover;" /></td>
          <td style="padding:12px 16px;"><div style="font-size:15px;font-weight:700;color:#1e293b;">Yas Waterworld</div><div style="font-size:12px;color:#64748b;margin:4px 0;">Abu Dhabi · water parks</div><div style="margin-top:6px;"><span style="font-size:16px;font-weight:700;color:#f97316;">AED 57.5</span></div><a href="https://www.raynatours.com/abu-dhabi/water-parks/yas-waterworld-e-111" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#f97316;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">Book Now</a></td></tr>
        </table>
      </td></tr>
    </table>
    <table width="100%" style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:12px;text-align:center;margin:16px 0;">
      <tr><td style="padding:16px;"><div style="font-size:12px;color:#92400e;font-weight:600;text-transform:uppercase;">Exclusive Comeback Offer</div><div style="font-size:28px;font-weight:800;color:#d97706;letter-spacing:3px;margin:8px 0;">WINBACK15</div><div style="font-size:13px;color:#92400e;">15% off your next booking · Limited time only</div></td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 32px;text-align:center;"><a href="https://www.raynatours.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=atrisk_winback" style="display:inline-block;padding:14px 40px;background:#f97316;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:700;">Claim Your 15% Off</a></td></tr>
  <tr><td style="background:#1e293b;padding:24px 32px;text-align:center;"><div style="color:#94a3b8;font-size:12px;line-height:1.6;">Rayna Tours LLC · Dubai, UAE<br/><a href="https://www.raynatours.com" style="color:#f97316;text-decoration:none;">raynatours.com</a> · <a href="mailto:akshith@rayna.com" style="color:#f97316;text-decoration:none;">akshith@rayna.com</a></div></td></tr>
</table></td></tr></table>
</body></html>'
WHERE segment_label LIKE 'At Risk%' AND channel = 'email';

-- Lost High-Value email - premium product showcase
UPDATE content_templates SET body = '<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
  <tr><td style="background:linear-gradient(135deg,#1e293b,#334155);padding:32px 40px;text-align:center;">
    <div style="color:#f59e0b;font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">✦ VIP Invitation ✦</div>
    <div style="color:#fff;font-size:26px;font-weight:800;margin-top:12px;line-height:1.3;">A Personal Invitation to Come Back 💎</div>
    <div style="color:#94a3b8;font-size:14px;margin-top:8px;">Exclusive experiences curated for you</div>
  </td></tr>
  <tr><td style="padding:24px 32px;">
    <p style="font-size:15px;color:#334155;line-height:1.6;">Dear {{first_name}},</p>
    <p style="font-size:15px;color:#334155;line-height:1.6;">As one of our most valued customers, we truly miss you. We''ve prepared an exclusive VIP comeback package:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr><td style="padding:8px 0;">
        <table width="100%" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td width="140"><img src="https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Helicopter-Ride-in-Abu-Dhabi-508786/helicopter-ride-in-abu-dhabi-front_3_2.jpg" width="140" height="100" style="display:block;object-fit:cover;" /></td>
          <td style="padding:12px 16px;"><div style="font-size:15px;font-weight:700;color:#1e293b;">Helicopter Ride Abu Dhabi</div><div style="font-size:12px;color:#64748b;margin:4px 0;">Premium Experience · Adventure</div><div style="margin-top:6px;"><span style="font-size:16px;font-weight:700;color:#f97316;">AED 700</span></div><a href="https://www.raynatours.com/abu-dhabi/adventure-tours/helicopter-ride-in-abu-dhabi-e-508786" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#1e293b;color:#f59e0b;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">VIP Access</a></td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:8px 0;">
        <table width="100%" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td width="140"><img src="https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Overnight-Safari-Abu-Dhabi-176/1725538156537_S.jpg" width="140" height="100" style="display:block;object-fit:cover;" /></td>
          <td style="padding:12px 16px;"><div style="font-size:15px;font-weight:700;color:#1e293b;">Overnight Safari Abu Dhabi</div><div style="font-size:12px;color:#64748b;margin:4px 0;">Premium Desert · Luxury Camp</div><div style="margin-top:6px;"><span style="font-size:16px;font-weight:700;color:#f97316;">AED 475</span></div><a href="https://www.raynatours.com/abu-dhabi/desert-safari-tours/overnight-safari-abu-dhabi-e-176" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#1e293b;color:#f59e0b;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">VIP Access</a></td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:8px 0;">
        <table width="100%" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td width="140"><img src="https://d31sl6cu4pqx6g.cloudfront.net/Tour-Images/Final/Rose-Royale-Mega-Yacht-Dinner-Cruise-509874/rose-royale-mega-yacht-dinner-cruise-front_3_2.jpg" width="140" height="100" style="display:block;object-fit:cover;" /></td>
          <td style="padding:12px 16px;"><div style="font-size:15px;font-weight:700;color:#1e293b;">Mega Yacht Dinner Cruise</div><div style="font-size:12px;color:#64748b;margin:4px 0;">Luxury Cruise · Rose Royale</div><div style="margin-top:6px;"><span style="font-size:16px;font-weight:700;color:#f97316;">AED 315</span></div><a href="https://www.raynatours.com/abu-dhabi/sightseeing-cruises/rose-royale-mega-yacht-dinner-cruise-e-509874" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#1e293b;color:#f59e0b;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">VIP Access</a></td></tr>
        </table>
      </td></tr>
    </table>
    <table width="100%" style="background:#1e293b;border-radius:12px;text-align:center;margin:16px 0;">
      <tr><td style="padding:20px;"><div style="color:#f59e0b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:2px;">Your VIP Comeback Package</div><div style="color:#fff;font-size:16px;margin:12px 0;line-height:1.5;">✓ 20% off all premium experiences<br/>✓ Complimentary upgrade on first booking<br/>✓ Dedicated travel advisor assigned</div><div style="font-size:28px;font-weight:800;color:#f59e0b;letter-spacing:3px;margin-top:8px;">WINBACK15</div></td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 32px;text-align:center;"><a href="https://www.raynatours.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=lost_vip_winback" style="display:inline-block;padding:14px 40px;background:#f59e0b;color:#1e293b;text-decoration:none;border-radius:8px;font-size:16px;font-weight:700;">Accept VIP Invitation</a></td></tr>
  <tr><td style="background:#1e293b;padding:24px 32px;text-align:center;"><div style="color:#94a3b8;font-size:12px;line-height:1.6;">Rayna Tours LLC · Dubai, UAE<br/><a href="https://www.raynatours.com" style="color:#f97316;text-decoration:none;">raynatours.com</a> · <a href="mailto:akshith@rayna.com" style="color:#f97316;text-decoration:none;">akshith@rayna.com</a></div></td></tr>
</table></td></tr></table>
</body></html>'
WHERE segment_label LIKE 'Lost High-Value%' AND channel = 'email';

COMMIT;
