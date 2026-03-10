-- phpMyAdmin SQL Dump
-- version 4.7.0
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Mar 09, 2026 at 05:15 AM
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
-- Table structure for table `tickets`
--

CREATE TABLE `tickets` (
  `id` int(11) NOT NULL,
  `dt` int(4) NOT NULL,
  `uid` varchar(10) DEFAULT NULL,
  `sno` varchar(10) DEFAULT NULL,
  `unique_id` text,
  `foreign_id` int(11) DEFAULT NULL,
  `t_from` varchar(100) NOT NULL,
  `from_name` varchar(75) DEFAULT NULL,
  `t_to` varchar(150) DEFAULT NULL,
  `cc` text,
  `bcc` text,
  `assoc` text,
  `subject` varchar(150) NOT NULL,
  `body` mediumtext,
  `extra` mediumtext,
  `produc` varchar(30) DEFAULT NULL,
  `pex` int(4) DEFAULT '0',
  `channel` int(5) DEFAULT '0',
  `time` varchar(40) DEFAULT NULL,
  `status` int(4) NOT NULL,
  `bill` varchar(50) DEFAULT NULL,
  `bill_total` varchar(11) DEFAULT NULL,
  `bill_currency` varchar(5) DEFAULT NULL,
  `contact_status` text,
  `assign_to` int(11) NOT NULL,
  `assign_time` datetime DEFAULT NULL,
  `aid` int(11) DEFAULT NULL,
  `due` datetime DEFAULT NULL,
  `travel` datetime DEFAULT NULL,
  `priority` int(1) NOT NULL DEFAULT '1',
  `attach` text,
  `seen` int(1) NOT NULL DEFAULT '0',
  `th` int(4) NOT NULL DEFAULT '1',
  `last_th` datetime DEFAULT NULL,
  `last_out` datetime DEFAULT NULL,
  `spam` int(11) NOT NULL DEFAULT '0',
  `confirm_time` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=MyISAM DEFAULT CHARSET=latin1;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `tickets`
--
ALTER TABLE `tickets`
  ADD PRIMARY KEY (`id`),
  ADD KEY `dt` (`dt`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `tickets`
--
ALTER TABLE `tickets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
