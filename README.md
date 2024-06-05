# NetSuite-Warranty
A collection of scripts used to generate warranty records and their replacements.

### Script Deployment Settings
Applies to: Item Receipt
Event Type: Create

## Warranty Creation Script
The aim of the script is to create a warranty record for all the details of the item, particularly the items serial number, the location it has been sent to and the date that the warranty will expire.

It first checks the locations on the item receipt and that if it is going from the warehouse (internal id: 321) and not the repair location (332) then it must be going to a hub and therefore needs a warranty record created.
It then goes through each of the line items. If the item record states that it is indeed an item that needs a warranty, the script continues.
It then checks if there are any time pool records in existance. A time pool record is created when an item is returned, to represent that an item still under warranty needs replacing and to continue where it left off. The record contains a number of days, the item type and a location.
If the item receipt matched the item type and location of an existing time record, then it must be a replacement and the days remaining are used to create the replacement warranty.
If the time remaining is used, the record is deleted.
If there is no time record, then it must be a new warranty and the item is created with a 10 year warranty.
The new warranty is saved.

## Warranty Return Script
The return warranty will check an item receipt to make sure the item is going from a hub to the warehouse or the repair location.
It then creates a time record based on the location and number of days remaining on the warranty.
After the time record is created, it deletes the associated warranty record of the item.
