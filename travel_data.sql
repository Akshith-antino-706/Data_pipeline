-- phpMyAdmin SQL Dump
-- version 4.7.0
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Mar 09, 2026 at 05:16 AM
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
-- Table structure for table `travel_data`
--

CREATE TABLE `travel_data` (
  `id` int(11) NOT NULL,
  `bill_serial` bigint(20) NOT NULL,
  `bill_number` bigint(20) NOT NULL,
  `bill_type` varchar(50) DEFAULT NULL,
  `service_name` text,
  `guest_name` varchar(50) DEFAULT NULL,
  `nationality` varchar(30) DEFAULT NULL,
  `contact` varchar(70) DEFAULT NULL,
  `email` varchar(50) NOT NULL,
  `age` varchar(10) DEFAULT NULL,
  `business_provider` varchar(70) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `last_date` date DEFAULT NULL,
  `bill_made_by` varchar(25) DEFAULT NULL,
  `added_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `type` varchar(10) DEFAULT NULL,
  `sent` int(1) DEFAULT '0'
) ENGINE=MyISAM DEFAULT CHARSET=latin1;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `travel_data`
--
ALTER TABLE `travel_data`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `travel_data`
--
ALTER TABLE `travel_data`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
