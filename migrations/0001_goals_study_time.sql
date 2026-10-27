CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`term` text DEFAULT 'month' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`color` text DEFAULT 'lime' NOT NULL,
	`due_date` text,
	`steps` text DEFAULT '[]' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`done_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "goals_term_check" CHECK("goals"."term" in ('long', 'month', 'week')),
	CONSTRAINT "goals_status_check" CHECK("goals"."status" in ('active', 'done', 'paused')),
	CONSTRAINT "goals_color_check" CHECK("goals"."color" in ('lime', 'pink', 'sky', 'orange', 'violet', 'mint', 'yellow')),
	CONSTRAINT "goals_progress_check" CHECK("goals"."progress" between 0 and 100)
);
--> statement-breakpoint
CREATE INDEX `goals_term_idx` ON `goals` (`term`,`sort_order`);--> statement-breakpoint
-- 글 표를 다시 만들지 않고 칸만 더해요. (다시 만들면 댓글·태그 연결이 지워질 수 있어요)
ALTER TABLE `posts` ADD `study_minutes` integer CONSTRAINT "posts_study_minutes_check" CHECK("study_minutes" is null or "study_minutes" between 0 and 1440);
