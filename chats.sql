-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Mar 09, 2026 at 12:32 PM
-- Server version: 8.0.32
-- PHP Version: 8.1.17

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
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
-- Table structure for table `chats`
--

CREATE TABLE `chats` (
  `id` int NOT NULL,
  `wa_id` varchar(20) NOT NULL,
  `wa_name` varchar(25) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `country` varchar(50) DEFAULT NULL,
  `receiver` varchar(20) NOT NULL,
  `assign_to` int NOT NULL DEFAULT '0',
  `boat` int DEFAULT NULL,
  `status` int NOT NULL,
  `priority` int NOT NULL DEFAULT '4',
  `tags` varchar(510) CHARACTER SET latin1 COLLATE latin1_swedish_ci DEFAULT NULL,
  `fv` int NOT NULL DEFAULT '0',
  `last_in` datetime DEFAULT NULL,
  `last_out` datetime DEFAULT NULL,
  `last_msg` datetime DEFAULT NULL,
  `last_short` varchar(60) DEFAULT NULL,
  `seen` int NOT NULL DEFAULT '1',
  `spam` int NOT NULL DEFAULT '0',
  `last_packed` varchar(15) NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL
) ENGINE=MyISAM DEFAULT CHARSET=latin1;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `chats`
--
ALTER TABLE `chats`
  ADD PRIMARY KEY (`id`),
  ADD KEY `receiver` (`receiver`),
  ADD KEY `assign_to` (`assign_to`),
  ADD KEY `status` (`status`),
  ADD KEY `last_msg` (`last_msg`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `chats`
--
ALTER TABLE `chats`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
