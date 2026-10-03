-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_targetOwnerId_fkey" FOREIGN KEY ("targetOwnerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
