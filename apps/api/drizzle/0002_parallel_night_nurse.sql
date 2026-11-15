ALTER TABLE "runs" ADD COLUMN "mode" varchar(16) DEFAULT 'mock' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "ip" varchar(64);