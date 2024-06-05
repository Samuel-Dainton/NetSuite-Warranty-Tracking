/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/log', 'N/search', 'N/format'], function (record, log, search, format) {

    function afterSubmit(context) {
        log.debug('Script Started');

        // Get the new record object
        var newRecord = context.newRecord;
        // Get the ID of the Item Receipt
        var itemReceiptId = newRecord.id;
        // Load the Item Receipt record
        var itemReceipt = record.load({
            type: record.Type.ITEM_RECEIPT,
            id: itemReceiptId,
            isDynamic: false
        });

        // Retrieve the from and to locations
        var toLocationId = itemReceipt.getValue({ fieldId: 'location' });
        var fromLocationId = itemReceipt.getValue({ fieldId: 'transferlocation' });

        // Check the from and to locations. 321 is CB Warehouse and 332 is CB Repairs.
        // So if going from 321 and not to 332, it must be going to a hub and needs warranty.
        if ((fromLocationId == 321 && toLocationId !== 332) || (fromLocationId == 332 && toLocationId !== 321)) {
            log.debug('Condition met, processing script.');

            // Retrieve item details from the Item Receipt's line items
            var lineCount = itemReceipt.getLineCount({ sublistId: 'item' });
            log.debug('Line Count: ' + lineCount);

            // Loop through each line item on the Item Receipt
            for (var i = 0; i < lineCount; i++) {
                var itemId = itemReceipt.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                // Check if the item is tracked for warranty
                var itemRecord = record.load({
                    type: record.Type.INVENTORY_ITEM,
                    id: itemId,
                    isDynamic: false
                });

                var isWarrantyTracked = itemRecord.getValue({ fieldId: 'custitem_wrm_item_trackwarranty' });

                if (isWarrantyTracked) {
                    var itemName = itemReceipt.getSublistText({ sublistId: 'item', fieldId: 'item', line: i });

                    // Retrieve the warranty term and type from the item record
                    var warrantyTerm = itemRecord.getValue({ fieldId: 'custitem_wrm_item_warrantyterms' });
                    var warrantyItemType = itemRecord.getValue({ fieldId: 'custitem_warranty_item_type' });

                    // Retrieve inventory detail subrecord
                    var inventoryDetailSubrecord = itemReceipt.getSublistSubrecord({
                        sublistId: 'item',
                        fieldId: 'inventorydetail',
                        line: i
                    });

                    if (inventoryDetailSubrecord) {
                        // Retrieve serial numbers from inventory assignments within inventory detail subrecord
                        var inventoryAssignmentCount = inventoryDetailSubrecord.getLineCount({ sublistId: 'inventoryassignment' });
                        log.debug('Inventory Assignment Count: ' + inventoryAssignmentCount + ' for Item ' + itemName);

                        for (var j = 0; j < inventoryAssignmentCount; j++) {
                            var serialNumber = inventoryDetailSubrecord.getSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'receiptinventorynumber',
                                line: j
                            });

                            log.debug('Serial Number: ' + serialNumber);

                            if (serialNumber) {
                                // Create warranty record
                                var warrantyRecord = record.create({ type: 'customrecord_wrm_warrantyreg', isDynamic: true });

                                // Set fields on the warranty record
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_subsidiary', value: 23 });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_ref_seriallot', value: serialNumber });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_customer', value: 5173 });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_quantity', value: 1 });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_warrantyterm', value: warrantyTerm });
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_item', value: itemName });
                                warrantyRecord.setValue({ fieldId: 'custrecord_custom_location', value: toLocationId });

                                // Populate the shiptoaddress field with the location name
                                var locationName = getLocationName(toLocationId);
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_shiptoaddress', value: locationName });

                                // Populate the warranty item type field
                                warrantyRecord.setValue({ fieldId: 'custrecord_warranty_item_type', value: warrantyItemType });

                                // Populate the remarks field
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_remarks', value: 'This record was automatically generated.' });

                                // Check if there's an existing warranty time record for this item type and location
                                var existingWarrantyTimeSearch = search.create({
                                    type: 'customrecord_warranty_time',
                                    filters: [
                                        ['custrecord_item_type', 'is', warrantyItemType],
                                        ['custrecord_time_pool_location', 'is', toLocationId]
                                    ],
                                    columns: ['internalid', 'custrecord_days_remaining']
                                });

                                var existingWarrantyTimeResults = existingWarrantyTimeSearch.run().getRange({ start: 0, end: 1 });

                                var expirationDate;
                                var currentDate = new Date();
                                if (existingWarrantyTimeResults.length > 0) {
                                    // Use existing warranty time record to calculate expiration date
                                    var daysRemaining = parseInt(existingWarrantyTimeResults[0].getValue({ name: 'custrecord_days_remaining' }), 10);
                                    expirationDate = new Date(currentDate.getTime() + (daysRemaining * 24 * 60 * 60 * 1000));

                                    // Log important steps
                                    log.debug('Warranty Time int: ' + existingWarrantyTimeResults);
                                    log.debug('Days Remaining: ' + daysRemaining);
                                    log.debug('Expiration date set based on existing warranty time record for item type: ' + warrantyItemType);
                                    log.debug('Expiration Date: ' + expirationDate);

                                } else {
                                    // Calculate the expiration date for the warranty (current date + 10 years) since it's a new item
                                    expirationDate = new Date(currentDate.getFullYear() + 10, currentDate.getMonth(), currentDate.getDate());

                                    // Log important steps
                                    log.debug('Expiration date set to 10 years from today since no existing warranty time record was found for item type: ' + warrantyItemType);
                                    log.debug('Expiration Date: ' + expirationDate);
                                }

                                // Set expiration date on the warranty record
                                warrantyRecord.setValue({ fieldId: 'custrecord_wrm_reg_warrantyexpire', value: expirationDate });

                                // Save warranty record
                                var warrantyRecordId = warrantyRecord.save();
                                log.debug('Warranty record saved with ID: ' + warrantyRecordId);

                                // Delete the existing warranty time record only if the new warranty record is saved successfully
                                if (existingWarrantyTimeResults.length > 0) {
                                    record.delete({ type: 'customrecord_warranty_time', id: existingWarrantyTimeResults[0].id });
                                    log.debug('Existing warranty time record deleted.');
                                }
                            }
                        }
                    }
                }
            }
        } else {
            log.debug('Condition not met, exiting script. To Location: ' + toLocationId + ' From Location: ' + fromLocationId);
        }

        log.debug('Script Ended');
    }

    // Function to get location name
    function getLocationName(locationId) {
        var locationName = '';
        var locationSearch = search.lookupFields({
            type: search.Type.LOCATION,
            id: locationId,
            columns: ['name']
        });
        if (locationSearch && locationSearch.name) {
            locationName = locationSearch.name;
        }
        return locationName;
    }

    return {
        afterSubmit: afterSubmit
    };

});
