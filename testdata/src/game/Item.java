package game;

public class Item {

    private String label;

    public Item() {
        this("unbenannt");
    }

    public Item(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
