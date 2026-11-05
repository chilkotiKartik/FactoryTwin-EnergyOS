CREATE TABLE `market_prices` (
	`source` text NOT NULL,
	`delivery_date` text NOT NULL,
	`block` integer NOT NULL,
	`start_min` integer NOT NULL,
	`mcp_rs_per_mwh` real NOT NULL,
	`mcv_mw` real NOT NULL,
	`purchase_bid_mw` real NOT NULL,
	`sell_bid_mw` real NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`source`, `delivery_date`, `block`)
);
