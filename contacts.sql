-- phpMyAdmin SQL Dump
-- version 4.7.0
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Mar 09, 2026 at 05:08 AM
-- Server version: 5.7.20-log
-- PHP Version: 5.6.31

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET AUTOCOMMIT = 0;
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `rayna_data`
--

-- --------------------------------------------------------

--
-- Table structure for table `contacts`
--

CREATE TABLE `contacts` (
  `id` int(10) NOT NULL,
  `foreign_id` int(11) DEFAULT NULL,
  `type` varchar(10) DEFAULT NULL,
  `contact_type` varchar(20) NOT NULL,
  `source_id` int(3) DEFAULT NULL,
  `subsource_id` int(3) DEFAULT '0',
  `source_type` varchar(50) DEFAULT NULL,
  `source_person` int(10) DEFAULT NULL,
  `name` varchar(75) DEFAULT NULL,
  `company_name` varchar(75) DEFAULT NULL,
  `designation` varchar(75) DEFAULT NULL,
  `dob` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `email2` text,
  `pcode` varchar(6) DEFAULT NULL,
  `mobile` varchar(20) DEFAULT NULL,
  `mobile2` text,
  `phone` varchar(20) DEFAULT NULL,
  `phone2` text,
  `website` varchar(100) DEFAULT NULL,
  `city` varchar(20) DEFAULT NULL,
  `cstate` varchar(20) DEFAULT NULL,
  `country_id` int(5) DEFAULT NULL,
  `country_name` varchar(20) DEFAULT NULL,
  `pincode` varchar(20) DEFAULT NULL,
  `address_line1` text,
  `address_line2` text,
  `hotel_name` varchar(75) DEFAULT NULL,
  `hotel_category` varchar(20) DEFAULT NULL,
  `agent_code` varchar(15) DEFAULT NULL,
  `registration_date` datetime DEFAULT NULL,
  `authorize_status` varchar(15) DEFAULT NULL,
  `authorize_employee` varchar(15) DEFAULT NULL,
  `added_by` int(10) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT '0',
  `rte` tinyint(1) NOT NULL DEFAULT '1',
  `rtc` tinyint(1) NOT NULL,
  `rts` tinyint(1) NOT NULL,
  `opn` int(1) NOT NULL DEFAULT '0',
  `contact_status` varchar(20) NOT NULL DEFAULT 'new',
  `calls` int(4) NOT NULL DEFAULT '0',
  `qe` int(4) NOT NULL DEFAULT '0',
  `n_queries` int(4) DEFAULT NULL,
  `l_query` date DEFAULT NULL,
  `n_bookings` int(4) DEFAULT NULL,
  `l_booking` date DEFAULT NULL,
  `registered` tinyint(1) DEFAULT '0',
  `priority` tinyint(1) NOT NULL,
  `assign_to` int(10) DEFAULT '0',
  `booking_date` datetime DEFAULT NULL,
  `traveld` int(1) DEFAULT '0',
  `traveld_name` varchar(50) DEFAULT NULL,
  `traveld_exp` datetime DEFAULT NULL,
  `s_bounce` varchar(4) DEFAULT '0',
  `h_bounce` varchar(4) DEFAULT '0',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `contacts`
--
ALTER TABLE `contacts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `source_id` (`source_id`),
  ADD KEY `assign_to` (`assign_to`),
  ADD KEY `l_booking` (`l_booking`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `contacts`
--
ALTER TABLE `contacts`
  MODIFY `id` int(10) NOT NULL AUTO_INCREMENT;COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
