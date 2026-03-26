-- CreateTable
CREATE TABLE "FoodOrderHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "cuisine" TEXT NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderTime" TIMESTAMP(3) NOT NULL,
    "deliveryDurationMinutes" INTEGER,
    "dayOfWeek" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodOrderHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodPattern" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "hourOfDay" INTEGER NOT NULL,
    "cuisine" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "typicalItems" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "averageCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "preferredPlatform" TEXT,
    "lastTriggered" TIMESTAMP(3),
    "consecutiveDismissals" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patternId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "platform" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "cuisine" TEXT NOT NULL,
    "estimatedCost" DOUBLE PRECISION NOT NULL,
    "estimatedDeliveryMin" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "platformData" JSONB,
    "alternatives" JSONB,
    "confirmedPlatform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodSuggestionFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "editedFields" JSONB,
    "dismissReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodSuggestionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FoodOrderHistory_userId_dayOfWeek_idx" ON "FoodOrderHistory"("userId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "FoodOrderHistory_userId_orderTime_idx" ON "FoodOrderHistory"("userId", "orderTime");

-- CreateIndex
CREATE INDEX "FoodPattern_userId_dayOfWeek_hourOfDay_idx" ON "FoodPattern"("userId", "dayOfWeek", "hourOfDay");

-- CreateIndex
CREATE UNIQUE INDEX "FoodPattern_userId_dayOfWeek_hourOfDay_restaurantName_key" ON "FoodPattern"("userId", "dayOfWeek", "hourOfDay", "restaurantName");

-- CreateIndex
CREATE INDEX "FoodSuggestion_userId_status_idx" ON "FoodSuggestion"("userId", "status");

-- CreateIndex
CREATE INDEX "FoodSuggestion_userId_createdAt_idx" ON "FoodSuggestion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FoodSuggestionFeedback_userId_action_idx" ON "FoodSuggestionFeedback"("userId", "action");

-- AddForeignKey
ALTER TABLE "FoodOrderHistory" ADD CONSTRAINT "FoodOrderHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodPattern" ADD CONSTRAINT "FoodPattern_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodSuggestion" ADD CONSTRAINT "FoodSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodSuggestionFeedback" ADD CONSTRAINT "FoodSuggestionFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodSuggestionFeedback" ADD CONSTRAINT "FoodSuggestionFeedback_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "FoodSuggestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
