// Featrures:
// Automated navigation through the booking portal.
// Input form filling (user details, preferences, etc.).
// Dynamic slot selection based on availability.
// Retry mechanism for failed attempts.
// Headless or visible browser execution mode.
// Logging for debugging and monitoring.

const puppeteer = require('puppeteer');
const prompt = require('prompt-sync')({ sigint: true });

(async () => {
    let browser;
    let page;

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function waitForSelectorWithRetry(selector, options = {}, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                await page.waitForSelector(selector, { visible: true, timeout: 10000, ...options });
                return true;
            } catch (e) {
                console.log(`Retry ${i + 1}/${retries} for selector: ${selector}`);
                await delay(2000);
                if (i === retries - 1) throw new Error(`Selector ${selector} not found after ${retries} retries`);
            }
        }
    }

    async function typeField(selector, value, fieldName) {
        try {
            await waitForSelectorWithRetry(selector);
            await page.focus(selector);
            await page.$eval(selector, el => el.value = '');
            await page.type(selector, value, { delay: 100 });
            const filledValue = await page.evaluate(s => document.querySelector(s)?.value, selector);
            console.log(`${fieldName} filled with "${filledValue}" using selector: ${selector}`);
            return filledValue;
        } catch (e) {
            console.error(`Failed to fill ${fieldName} with selector ${selector}: ${e.message}`);
            throw e;
        }
    }

    async function fillDateField(selector, dateValue, fieldName) {
        try {
            await waitForSelectorWithRetry(selector);
            await page.waitForFunction(s => document.querySelector(s).offsetParent !== null, { timeout: 10000 }, selector);
            await page.focus(selector);
            await page.$eval(selector, el => el.value = '');

            // Split the date into parts
            const [day, month, year] = dateValue.split('/');
            console.log(`Filling ${fieldName} with Day: ${day}, Month: ${month}, Year: ${year}`);

            // Strategy 1: Type each segment with deliberate pauses
            for (const char of day) {
                await page.keyboard.press(char);
                await delay(150);
            }
            await page.keyboard.press('/');
            await delay(200);

            for (const char of month) {
                await page.keyboard.press(char);
                await delay(150);
            }
            await page.keyboard.press('/');
            await delay(200);

            // Extra care for the year to ensure all digits are entered
            for (const char of year) {
                await page.keyboard.press(char);
                await delay(250); // Slower delay for year digits
            }
            await page.keyboard.press('Tab'); // Trigger blur/validation
            let filledValue = await page.evaluate(s => document.querySelector(s)?.value, selector);
            console.log(`After typing: "${filledValue}"`);

            // Check if the year was truncated or incorrect
            if (filledValue !== dateValue) {
                console.log(`Typed value "${filledValue}" doesn’t match "${dateValue}", attempting correction...`);
                await page.click(selector, { clickCount: 3 });
                await page.keyboard.press('Backspace');
                
                // Strategy 2: Retype with longer delays
                await page.type(selector, dateValue, { delay: 300 });
                await page.evaluate(s => document.querySelector(s).blur(), selector);
                filledValue = await page.evaluate(s => document.querySelector(s)?.value, selector);
            }

            // Strategy 3: Final JavaScript injection if still incorrect
            if (filledValue !== dateValue) {
                console.log(`Retype failed (got "${filledValue}"), forcing value via JavaScript...`);
                await page.evaluate((s, val) => {
                    const input = document.querySelector(s);
                    input.value = val;
                    ['input', 'change', 'blur'].forEach(event => {
                        input.dispatchEvent(new Event(event, { bubbles: true }));
                    });
                }, selector, dateValue);
                filledValue = await page.evaluate(s => document.querySelector(s)?.value, selector);
            }

            // Final verification
            if (filledValue === dateValue) {
                console.log(`${fieldName} successfully filled with "${filledValue}"`);
            } else {
                console.error(`${fieldName} failed: expected "${dateValue}", got "${filledValue}"`);
                const fieldState = await page.evaluate(s => {
                    const el = document.querySelector(s);
                    return {
                        value: el.value,
                        disabled: el.disabled,
                        readOnly: el.readOnly,
                        ariaInvalid: el.getAttribute('aria-invalid')
                    };
                }, selector);
                console.log("Field state:", fieldState);
            }
            await delay(1000);
            return filledValue;
        } catch (e) {
            console.error(`Failed to fill ${fieldName} with selector ${selector}: ${e.message}`);
            throw e;
        }
    }

    try {
        browser = await puppeteer.launch({
            headless: false,
            executablePath: '/usr/bin/brave-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto('https://uk.dentalhub.online/soe/new/Kilmarnock%20Smile%20Studio?pid=UKSHQ02', { waitUntil: 'networkidle2', timeout: 60000 });

        console.log("Collecting patient information...");
        const firstName = prompt("Enter First Name: ").trim() || "John";
        const lastName = prompt("Enter Last Name: ").trim() || "Doe";
        let dateOfBirth = prompt("Enter Date of Birth (DD/MM/YYYY): ").trim();
        while (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateOfBirth)) {
            console.log("Invalid format. Use DD/MM/YYYY (e.g., 20/10/2002).");
            dateOfBirth = prompt("Enter Date of Birth (DD/MM/YYYY): ").trim();
        }
        let sex = prompt("Enter Sex (Male/Female/Other): ").trim().toLowerCase();
        while (!["male", "female", "other"].includes(sex)) {
            console.log("Invalid input. Enter 'Male', 'Female', or 'Other'.");
            sex = prompt("Enter Sex (Male/Female/Other): ").trim().toLowerCase();
        }
        let mobileNumber = prompt("Enter Mobile Number (e.g., +14155550132 or 07123456789): ").trim();
        while (!/^\+?\d{10,12}$/.test(mobileNumber)) {
            console.log("Invalid number. Enter 10-12 digits, optionally with '+' (e.g., +14155550132).");
            mobileNumber = prompt("Enter Mobile Number (e.g., +14155550132 or 07123456789): ").trim();
        }
        const email = prompt("Enter E-mail Address: ").trim() || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;
        const callback = prompt("Would you like an appointment confirmation call? (yes/no): ").toLowerCase().trim() === "yes";
        const medicalInfo = prompt("Enter Medical Considerations (or press Enter to skip): ").trim();

        const patientType = prompt("Enter patient type (NewPatient/ExistingPatient): ").trim().toLowerCase() === "newpatient" ? "newpatient" : "existingpatient";
        let insuranceType = prompt("Enter insurance type (Private/NHS): ").trim();
        while (!["Private", "NHS"].includes(insuranceType)) {
            console.log("Invalid type. Enter 'Private' or 'NHS'.");
            insuranceType = prompt("Enter insurance type (Private/NHS): ").trim();
        }
        const appointmentType = prompt("Enter appointment type (e.g., Air Polish): ").trim() || "Air Polish";
        const providerType = prompt("Enter provider (e.g., Any Provider, Edward, Meenakshi): ").trim() || "Any Provider";

        console.log("Accepting cookies...");
        try {
            await waitForSelectorWithRetry('#onetrust-accept-btn-handler');
            await page.click('#onetrust-accept-btn-handler');
        } catch (e) {
            console.log("No cookie popup found, proceeding...");
        }
        await delay(1000);

        console.log(`Selecting patient type: ${patientType}`);
        const patientSelector = patientType === "newpatient" 
            ? '[data-testid="t-appointmenttype-selector-new"]' 
            : '[data-testid="t-appointmenttype-selector-existing"]';
        await waitForSelectorWithRetry(patientSelector, { timeout: 60000 });
        await page.click(patientSelector);

        console.log(`Selecting insurance type: ${insuranceType}`);
        await waitForSelectorWithRetry(`button[value="${insuranceType}"]`, { timeout: 60000 });
        await page.click(`button[value="${insuranceType}"]`);
        await delay(2000);

        console.log("Setting appointment type...");
        const reasonSelector = '[data-testid="t-reason-selector"]';
        await waitForSelectorWithRetry(reasonSelector);
        await page.waitForFunction(selector => !document.querySelector(selector).classList.contains('Mui-disabled'), 
            { timeout: 90000 }, reasonSelector);
        await page.click(`${reasonSelector} .MuiSelect-select`);
        await waitForSelectorWithRetry('[role="option"]', { timeout: 60000 });
        await page.evaluate(appointment => {
            const option = Array.from(document.querySelectorAll('[role="option"]'))
                .find(opt => opt.textContent.trim().toLowerCase().includes(appointment.toLowerCase())) || 
                document.querySelector('[data-value="0-54-418"]');
            if (option) option.click();
        }, appointmentType);
        console.log(`Selected appointment type: ${appointmentType}`);
        await delay(2000);

        console.log("Setting provider...");
        const providerSelector = '[data-testid="t-provider-selector"]';
        await waitForSelectorWithRetry(providerSelector);
        await page.waitForFunction(selector => !document.querySelector(selector).classList.contains('Mui-disabled'), 
            { timeout: 90000 }, providerSelector);
        await page.click(`${providerSelector} .MuiSelect-select`);
        await waitForSelectorWithRetry('[data-testid^="t-provider-selector-item-"]', { timeout: 60000 });
        await page.evaluate(provider => {
            const options = Array.from(document.querySelectorAll('[data-testid^="t-provider-selector-item-"]'));
            const selected = options.find(opt => opt.textContent.trim().toLowerCase().includes(provider.toLowerCase())) || 
                           options.find(opt => opt.textContent.trim().toLowerCase() === "any provider") || 
                           options[0];
            if (selected) selected.click();
        }, providerType);
        console.log(`Selected provider: ${providerType}`);
        await delay(2000);

        async function extractAvailability() {
            await waitForSelectorWithRetry('.MuiTable-root', { timeout: 30000 });
            return await page.evaluate(() => {
                const days = Array.from(document.querySelectorAll('.MuiTableHead-root th'))
                    .map(th => `${th.querySelector('span:first-child')?.textContent.trim() || ''} ${th.querySelector('span:last-child')?.textContent.trim().replace(/\s+/g, ' ') || ''}`);
                const slots = Array.from(document.querySelectorAll('.MuiTableBody-root tr'))
                    .map(row => Array.from(row.querySelectorAll('td'))
                        .map(td => {
                            const time = td.querySelector('p')?.textContent.trim();
                            return time && /[0-1]?[0-9]:[0-5][0-9]\s*[ap]m/i.test(time) && td.classList.contains('available-time') ? time : null;
                        }));
                const result = {};
                days.forEach((day, i) => result[day] = slots.map(row => row[i]).filter(time => time));
                return result;
            });
        }

        async function getAppointmentSummary() {
            return await page.evaluate(() => {
                const timeElement = document.querySelector('[data-testid="t-appointmentsummary-time"] .date');
                const salesElement = document.querySelector('[data-testid="t-appointmentsummary-salesinformation"] .date');
                const summaryElement = document.querySelector('[data-testid="t-appointmentsummary-summarytext"] div');

                return {
                    dateTime: timeElement ? {
                        month: timeElement.querySelector('.mon')?.textContent.trim() || '',
                        day: timeElement.querySelector('.day')?.textContent.trim() || '',
                        time: timeElement.querySelector('.time')?.textContent.trim() || ''
                    } : "Not found",
                    salesInfo: salesElement ? {
                        price: salesElement.children[1]?.textContent.trim() || '',
                        deposit: salesElement.children[3]?.textContent.trim() || ''
                    } : "Not found",
                    summaryText: summaryElement ? summaryElement.textContent.trim() : "Not found"
                };
            });
        }

        let continueLoop = true;
        while (continueLoop) {
            const availability = await extractAvailability();
            console.log("Available slots:", JSON.stringify(availability, null, 2));

            const allSlots = [];
            Object.entries(availability).forEach(([day, times]) => times.forEach(time => allSlots.push(`${day} at ${time}`)));

            if (allSlots.length === 0) {
                console.log("No available slots this week.");
                const weekChoice = prompt("Choose week navigation (previous/next/skip): ").toLowerCase().trim();
                if (weekChoice === "previous") {
                    await page.click('[data-testid="t-availability-previous"]', { timeout: 30000 });
                    await delay(2000);
                } else if (weekChoice === "next") {
                    await page.click('[data-testid="t-availability-next"]', { timeout: 30000 });
                    await delay(2000);
                } else if (weekChoice === "skip") {
                    continueLoop = false;
                }
                continue;
            }

            console.log("Available time slots (select a number to see details):");
            allSlots.forEach((slot, index) => console.log(`${index + 1}: ${slot}`));
            const slotChoice = parseInt(prompt("Enter slot number to preview (or '0' to browse): ").trim()) - 1;

            if (slotChoice >= 0 && slotChoice < allSlots.length) {
                const selectedSlot = allSlots[slotChoice];
                console.log(`Previewing: ${selectedSlot}`);
                const [day, time] = selectedSlot.split(" at ");
                const dayIndex = Object.keys(availability).indexOf(day);
                const timeIndex = availability[day].indexOf(time);
                const slotSelector = `[data-testid="t-availability-${timeIndex}-${dayIndex}"]`;
                await waitForSelectorWithRetry(slotSelector, { timeout: 30000 });
                await page.click(slotSelector);

                console.log("Fetching appointment summary...");
                await waitForSelectorWithRetry('[data-testid="t-appointmentsummary-time"]', { timeout: 30000 });
                const appointmentSummary = await getAppointmentSummary();
                console.log("Appointment Summary:");
                console.log(`- Date: ${appointmentSummary.dateTime.month} ${appointmentSummary.dateTime.day}`);
                console.log(`- Time: ${appointmentSummary.dateTime.time}`);
                console.log(`- Price: ${appointmentSummary.salesInfo.price}`);
                console.log(`- Deposit: ${appointmentSummary.salesInfo.deposit}`);
                console.log(`- Summary: ${appointmentSummary.summaryText}`);

                if (prompt("Confirm this slot? (yes/no): ").toLowerCase().trim() === "yes") {
                    await page.click('[data-testid="t-tpd-gdpr-terms-of-use"]');
                    await page.click('[data-testid="t-tpd-gdpr-contact-consent"]');
                    await delay(1000);

                    const continueButton = '[data-testid="t-book-next"]';
                    await waitForSelectorWithRetry(continueButton, { timeout: 30000 });
                    await page.click(continueButton);
                    await delay(5000);

                    console.log("Filling patient information...");
                    await typeField('input#givenname', firstName, "First Name");
                    await typeField('input#familyname', lastName, "Last Name");
                    
                    await fillDateField('input#mui-3', dateOfBirth, "Date of Birth");

                    await waitForSelectorWithRetry('[data-testid="t-patient-sex"]');
                    await page.click('[data-testid="t-patient-sex"]');
                    await waitForSelectorWithRetry('[role="option"]', { timeout: 60000 });
                    await page.evaluate(sex => {
                        const option = Array.from(document.querySelectorAll('[role="option"]'))
                            .find(opt => opt.textContent.trim().toLowerCase() === sex.toLowerCase());
                        if (option) option.click();
                    }, sex.charAt(0).toUpperCase() + sex.slice(1).toLowerCase());
                    await delay(1000);

                    const phoneInput = 'input#mui-5';
                    await typeField(phoneInput, mobileNumber, "Phone Number");

                    const emailInput = 'input#mui-6';
                    await typeField(emailInput, email, "Email");

                    if (callback) {
                        await waitForSelectorWithRetry('[data-testid="t-patient-callback"] input');
                        await page.click('[data-testid="t-patient-callback"] input');
                        await delay(1000);
                    }
                    if (medicalInfo) {
                        await typeField('textarea#mui-7', medicalInfo, "Medical Info");
                    }

                    const verifyButton = '[data-testid="t-book-next"]';
                    await waitForSelectorWithRetry(verifyButton, { timeout: 30000 });
                    await page.waitForFunction(
                        sel => !document.querySelector(sel).hasAttribute('disabled'),
                        { timeout: 30000 }, verifyButton
                    );
                    await page.click(verifyButton);

                    const otpInput = '.MuiInputBase-input.MuiOutlinedInput-input';
                    await waitForSelectorWithRetry(otpInput, { timeout: 60000 });
                    let otp = prompt("Enter the 4-digit OTP received on your phone: ").trim();
                    while (!/^\d{4}$/.test(otp)) {
                        console.log("Invalid OTP. Please enter a 4-digit code.");
                        otp = prompt("Enter the 4-digit OTP received on your phone: ").trim();
                    }
                    await page.type(otpInput, otp, { delay: 100 });
                    await delay(1000);

                    const depositButton = '[data-testid="t-book-next"]';
                    await waitForSelectorWithRetry(depositButton, { timeout: 30000 });
                    await page.waitForFunction(
                        sel => !document.querySelector(sel).hasAttribute('disabled'),
                        { timeout: 30000 }, depositButton
                    );
                    await page.click(depositButton);

                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
                    console.log("Booking confirmation URL:", page.url());
                    continueLoop = false;
                }
            } else if (slotChoice === -1) {
                const weekChoice = prompt("Choose week navigation (previous/next/skip): ").toLowerCase().trim();
                if (weekChoice === "previous") {
                    await page.click('[data-testid="t-availability-previous"]', { timeout: 30000 });
                    await delay(2000);
                } else if (weekChoice === "next") {
                    await page.click('[data-testid="t-availability-next"]', { timeout: 30000 });
                    await delay(2000);
                } else if (weekChoice === "skip") {
                    continueLoop = false;
                }
            }
        }

        console.log("Process completed successfully!");
        await delay(5000);
    } catch (error) {
        console.error("Error occurred:", error.message);
        console.error("Stack trace:", error.stack);
        if (page) {
            await page.screenshot({ path: 'error-screenshot.png' });
            console.log("Screenshot saved as 'error-screenshot.png'");
        }
        throw error;
    } finally {
        if (browser) await browser.close();
    }
})();
